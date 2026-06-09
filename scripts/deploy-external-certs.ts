import { X509Certificate } from "node:crypto";
import { connect as tlsConnect } from "node:tls";

type Strategy =
  | { type: "proxmox"; nodes: { name: string; ipAddress: string }[] }
  | { type: "truenas"; importedNamePrefix?: string }
  | { type: "unifi-local-api" };

type Target = {
  name: string;
  ipAddress: string;
  port: number;
  backendHostname: string;
  strategy: Strategy;
};

type Endpoint = {
  label: string;
  host: string;
  port: number;
  deploy: () => Promise<void>;
};

const CERT_PATH = process.env.CERT_PATH ?? "/certs/tls.crt";
const KEY_PATH = process.env.KEY_PATH ?? "/certs/tls.key";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required env ${name}`);
  }

  return value;
}

function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/:/g, "").toUpperCase();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function notify(
  level: "success" | "failure",
  title: string,
  body: string,
): Promise<void> {
  console.log(`[${level}] ${title} - ${body}`);

  const appriseUrl = process.env.APPRISE_URL;
  const appriseKey = process.env.APPRISE_KEY;

  if (!appriseUrl || !appriseKey) {
    return;
  }

  try {
    await fetch(`${appriseUrl}/notify/${appriseKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        body,
        type: level === "success" ? "success" : "failure",
        tag: level === "success" ? "deploy" : "critical",
      }),
    });
  } catch (error) {
    console.error("notify failed:", error);
  }
}

async function pingHealthcheck(ok: boolean): Promise<void> {
  const base = process.env.HEALTHCHECK_URL;

  if (!base) {
    return;
  }

  try {
    await fetch(ok ? base : `${base}/fail`, { method: "GET" });
  } catch (error) {
    console.error("healthcheck ping failed:", error);
  }
}

function insecureFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { ...init, tls: { rejectUnauthorized: false } });
}

function probeLiveFingerprint(
  host: string,
  port: number,
  servername: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = tlsConnect(
      { host, port, servername, rejectUnauthorized: false, timeout: 10_000 },
      () => {
        const cert = socket.getPeerCertificate(false);
        socket.end();
        resolve(
          cert?.fingerprint256
            ? normalizeFingerprint(cert.fingerprint256)
            : null,
        );
      },
    );

    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });
}

async function probeUntil(
  host: string,
  port: number,
  servername: string,
  desiredFingerprint: string,
  attempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const live = await probeLiveFingerprint(host, port, servername);

    if (live === desiredFingerprint) {
      return true;
    }

    await Bun.sleep(5_000);
  }

  return false;
}

async function deployProxmox(
  host: string,
  port: number,
  node: string,
  certPem: string,
  keyPem: string,
): Promise<void> {
  const tokenId = requireEnv("PROXMOX_TOKEN_ID");
  const tokenSecret = requireEnv("PROXMOX_TOKEN_SECRET");
  const url = `https://${host}:${port}/api2/json/nodes/${node}/certificates/custom`;

  const body = new URLSearchParams({
    certificates: certPem,
    key: keyPem,
    force: "1",
    restart: "1",
  });

  const response = await insecureFetch(url, {
    method: "POST",
    headers: {
      Authorization: `PVEAPIToken=${tokenId}=${tokenSecret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(
      `Proxmox cert upload failed: ${response.status} ${await response.text()}`,
    );
  }
}

type TrueNasRpcResponse = {
  id: number;
  result?: unknown;
  error?: { message?: string; data?: unknown };
};

class TrueNasClient {
  private ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as TrueNasRpcResponse;
      const waiter = this.pending.get(message.id);

      if (!waiter) {
        return;
      }

      this.pending.delete(message.id);

      if (message.error) {
        waiter.reject(
          new Error(message.error.message ?? JSON.stringify(message.error)),
        );
      } else {
        waiter.resolve(message.result);
      }
    });
  }

  static connect(host: string): Promise<TrueNasClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://${host}/api/current`, {
        tls: { rejectUnauthorized: false },
      } as unknown as string[]);

      ws.addEventListener("open", () => resolve(new TrueNasClient(ws)));
      ws.addEventListener("error", () =>
        reject(new Error("TrueNAS websocket connection failed")),
      );
    });
  }

  call(method: string, params: unknown[] = []): Promise<unknown> {
    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  close(): void {
    this.ws.close();
  }
}

type TrueNasCertificate = { id: number; name: string };

async function deployTruenas(
  host: string,
  prefix: string,
  certPem: string,
  keyPem: string,
): Promise<void> {
  const apiKey = requireEnv("TRUENAS_API_KEY");
  const username = process.env.TRUENAS_USERNAME ?? "truenas_admin";
  const importName = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

  const client = await TrueNasClient.connect(host);

  try {
    await client.call("auth.login_ex", [
      { mechanism: "API_KEY_PLAIN", username, api_key: apiKey },
    ]);

    const createJobId = (await client.call("certificate.create", [
      {
        create_type: "CERTIFICATE_CREATE_IMPORTED",
        name: importName,
        certificate: certPem,
        privatekey: keyPem,
      },
    ])) as number;

    await client.call("core.job_wait", [createJobId]);

    const certificates = (await client.call("certificate.query", [
      [["name", "=", importName]],
    ])) as TrueNasCertificate[];

    const created = certificates[0];

    if (!created) {
      throw new Error(`TrueNAS imported cert ${importName} not found`);
    }

    await client.call("system.general.update", [
      { ui_certificate: created.id },
    ]);

    const allCerts = (await client.call("certificate.query", [
      [["name", "^", prefix]],
    ])) as TrueNasCertificate[];

    for (const cert of allCerts) {
      if (cert.id === created.id) {
        continue;
      }

      const deleteJobId = (await client.call("certificate.delete", [
        cert.id,
      ])) as number;
      await client.call("core.job_wait", [deleteJobId]);
    }

    await client.call("system.general.ui_restart", []);
  } finally {
    client.close();
  }
}

function csrfTokenFromCookies(setCookie: string | null): {
  cookie: string;
  csrf: string | null;
} {
  const token = setCookie?.match(/TOKEN=([^;]+)/)?.[1];

  if (!token) {
    throw new Error("UniFi login did not return a TOKEN cookie");
  }

  // The CSRF token is embedded in the JWT TOKEN cookie payload; UniFi requires
  // it echoed back in the X-CSRF-Token header on mutating requests.
  let csrf: string | null = null;
  const payload = token.split(".")[1];

  if (payload) {
    try {
      const decoded = JSON.parse(
        Buffer.from(payload, "base64").toString("utf8"),
      ) as { csrfToken?: string };
      csrf = decoded.csrfToken ?? null;
    } catch {
      csrf = null;
    }
  }

  return { cookie: `TOKEN=${token}`, csrf };
}

type UnifiCertificate = { id: string; name: string; active?: boolean };

async function deployUnifi(
  host: string,
  port: number,
  name: string,
  certPem: string,
  keyPem: string,
): Promise<void> {
  const username = requireEnv("UNIFI_USERNAME");
  const password = requireEnv("UNIFI_PASSWORD");
  const base = `https://${host}:${port}`;
  const certName = `${name}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;

  const login = await insecureFetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  if (!login.ok) {
    throw new Error(`UniFi login failed: ${login.status}`);
  }

  const { cookie, csrf } = csrfTokenFromCookies(login.headers.get("set-cookie"));
  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: cookie,
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
  };

  try {
    const upload = await insecureFetch(`${base}/api/userCertificates`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name: certName, cert: certPem, key: keyPem }),
    });

    if (!upload.ok) {
      throw new Error(
        `UniFi cert upload failed: ${upload.status} ${await upload.text()}`,
      );
    }

    const created = (await upload.json()) as UnifiCertificate;

    const activate = await insecureFetch(
      `${base}/api/userCertificates/${created.id}/status`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ active: true }),
      },
    );

    if (!activate.ok) {
      throw new Error(
        `UniFi cert activation failed: ${activate.status} ${await activate.text()}`,
      );
    }

    const list = await insecureFetch(`${base}/api/userCertificates`, {
      headers: authHeaders,
    });

    if (list.ok) {
      const certificates = (await list.json()) as UnifiCertificate[];

      for (const cert of certificates) {
        if (cert.id === created.id || !cert.name.startsWith(`${name}-`)) {
          continue;
        }

        await insecureFetch(`${base}/api/userCertificates/${cert.id}`, {
          method: "DELETE",
          headers: authHeaders,
        });
      }
    }
  } finally {
    await insecureFetch(`${base}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders,
    }).catch(() => undefined);
  }
}

function strategyEndpoints(
  target: Target,
  certPem: string,
  keyPem: string,
): Endpoint[] {
  switch (target.strategy.type) {
    case "proxmox":
      return target.strategy.nodes.map((node) => ({
        label: `${target.name}/${node.name}`,
        host: node.ipAddress,
        port: target.port,
        deploy: () =>
          deployProxmox(node.ipAddress, target.port, node.name, certPem, keyPem),
      }));
    case "truenas": {
      const prefix = target.strategy.importedNamePrefix ?? `${target.name}-deploy`;
      return [
        {
          label: target.name,
          host: target.ipAddress,
          port: target.port,
          deploy: () => deployTruenas(target.ipAddress, prefix, certPem, keyPem),
        },
      ];
    }
    case "unifi-local-api":
      return [
        {
          label: target.name,
          host: target.ipAddress,
          port: target.port,
          deploy: () =>
            deployUnifi(
              target.ipAddress,
              target.port,
              target.name,
              certPem,
              keyPem,
            ),
        },
      ];
  }
}

async function reconcileEndpoint(
  endpoint: Endpoint,
  servername: string,
  desiredFingerprint: string,
): Promise<"in-sync" | "deployed"> {
  const live = await probeLiveFingerprint(
    endpoint.host,
    endpoint.port,
    servername,
  );

  if (live === desiredFingerprint) {
    console.log(`${endpoint.label}: already in sync`);
    return "in-sync";
  }

  console.log(
    `${endpoint.label}: drift (live=${live ?? "none"} desired=${desiredFingerprint}); deploying`,
  );

  await endpoint.deploy();

  if (
    !(await probeUntil(endpoint.host, endpoint.port, servername, desiredFingerprint, 6))
  ) {
    throw new Error(
      `${endpoint.label}: still not serving the expected cert after deploy`,
    );
  }

  return "deployed";
}

async function main(): Promise<void> {
  const target = JSON.parse(requireEnv("DEPLOY_TARGET")) as Target;
  const certPem = await Bun.file(CERT_PATH).text();
  const keyPem = await Bun.file(KEY_PATH).text();
  const desiredFingerprint = normalizeFingerprint(
    new X509Certificate(certPem).fingerprint256,
  );

  const endpoints = strategyEndpoints(target, certPem, keyPem);
  const failures: string[] = [];
  let deployedCount = 0;

  for (const endpoint of endpoints) {
    try {
      const result = await reconcileEndpoint(
        endpoint,
        target.backendHostname,
        desiredFingerprint,
      );

      if (result === "deployed") {
        deployedCount += 1;
      }
    } catch (error) {
      failures.push(`${endpoint.label}: ${errorMessage(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  if (deployedCount > 0) {
    await notify(
      "success",
      `Cert deployed: ${target.name}`,
      `${target.backendHostname} renewed on ${deployedCount} endpoint(s).`,
    );
  }

  await pingHealthcheck(true);
}

try {
  await main();
} catch (error) {
  const message = errorMessage(error);
  await notify("failure", "Cert deploy FAILED", message);
  await pingHealthcheck(false);
  console.error(message);
  process.exit(1);
}
