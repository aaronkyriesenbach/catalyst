import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  externalAppBackendCertSecretName,
  externalAppDownloadBaseName,
  externalApps,
} from "../apps/traefik/externalApps.config";
import { certManagerNamespace } from "../apps/cert-manager";
import { traefikNamespace } from "../apps/traefik";
import { internalRootCaSecretName } from "../apps/cert-manager/internal-ca";

type Secret = {
  data?: Record<string, string | undefined>;
};

type Options = {
  dryRun: boolean;
  outputDir: string;
};

function parseArgs(args: string[]): Options {
  let dryRun = false;
  let outputDir = join(process.cwd(), "downloads", "external-certs");

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--output-dir") {
      const nextArg = args[index + 1];

      if (!nextArg) {
        throw new Error("Missing value for --output-dir");
      }

      outputDir = nextArg;
      index += 1;
      continue;
    }

    if (arg === "--help") {
      console.log(
        [
          "Usage: bun run sync-external-certs [--dry-run] [--output-dir <path>]",
          "",
          "Downloads the internal root CA and external app certificates from the cluster",
          "and writes cert/key files to a local output directory.",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    dryRun,
    outputDir,
  };
}

async function runCommand(command: string[], input?: string) {
  const proc = Bun.spawn({
    cmd: command,
    stdin: input ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (input && proc.stdin) {
    proc.stdin.write(input);
    proc.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${command.join(" ")}`,
        stderr.trim() || stdout.trim() || `exit code ${exitCode}`,
      ].join("\n"),
    );
  }

  return stdout;
}

async function getSecret(namespace: string, name: string) {
  const stdout = await runCommand([
    "kubectl",
    "get",
    "secret",
    name,
    "-n",
    namespace,
    "-o",
    "json",
  ]);

  return JSON.parse(stdout) as Secret;
}

function decodeSecretKey(secret: Secret, key: string, secretName: string) {
  const value = secret.data?.[key];

  if (!value) {
    throw new Error(`Secret ${secretName} is missing data.${key}`);
  }

  return Buffer.from(value, "base64").toString("utf8");
}

async function writePemFile(path: string, contents: string, mode?: number) {
  await Bun.write(path, contents);

  if (mode !== undefined) {
    await chmod(path, mode);
  }
}

const options = parseArgs(process.argv.slice(2));

if (!options.dryRun) {
  await mkdir(options.outputDir, { recursive: true });
}

const internalRootCaSecret = await getSecret(
  certManagerNamespace,
  internalRootCaSecretName,
);
const internalRootCaCertificate = decodeSecretKey(
  internalRootCaSecret,
  "tls.crt",
  `${certManagerNamespace}/${internalRootCaSecretName}`,
);
const internalRootCaPath = join(options.outputDir, "internal-root-ca.crt");

if (options.dryRun) {
  console.log(`[dry-run] Would write ${internalRootCaPath}`);
} else {
  await writePemFile(internalRootCaPath, internalRootCaCertificate);
}

for (const app of externalApps) {
  const secretName = externalAppBackendCertSecretName(app);
  const secret = await getSecret(traefikNamespace, secretName);
  const certificate = decodeSecretKey(
    secret,
    "tls.crt",
    `${traefikNamespace}/${secretName}`,
  );
  const privateKey = decodeSecretKey(
    secret,
    "tls.key",
    `${traefikNamespace}/${secretName}`,
  );
  const fileBase = join(options.outputDir, externalAppDownloadBaseName(app));
  const certificatePath = `${fileBase}.crt`;
  const privateKeyPath = `${fileBase}.key`;

  if (options.dryRun) {
    console.log(`[dry-run] Would write ${certificatePath}`);
    console.log(`[dry-run] Would write ${privateKeyPath}`);
    continue;
  }

  await writePemFile(certificatePath, certificate);
  await writePemFile(privateKeyPath, privateKey, 0o600);
}

console.log(
  options.dryRun
    ? "[dry-run] External certificate sync completed."
    : `External certificate sync completed. Files written to ${options.outputDir}`,
);
