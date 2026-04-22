import { Deployment } from "kubernetes-models/apps/v1";
import type { IPodSpec, IServicePort } from "kubernetes-models/v1";
import { Service } from "kubernetes-models/v1";
import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { stringify } from "yaml";
import type { AppConfig, ResourceLike, StaticApp, WorkloadApp } from "./types";

export function readFile(relativePath: string, base: string): Promise<string> {
  return Bun.file(new URL(relativePath, base)).text();
}

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

export function buildDeployment(name: string, podSpec: IPodSpec) {
  return new Deployment({
    metadata: {
      name,
      labels: { app: name },
    },
    spec: {
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: podSpec,
      },
    },
  });
}

export function buildService(name: string, ports: IServicePort[]) {
  return new Service({
    metadata: { name },
    spec: {
      selector: { app: name },
      ports,
    },
  });
}

type RouteOptions = {
  subDomain?: string;
  serviceName?: string;
  namespace?: string;
  externallyAccessible?: boolean;
  forwardAuth?: boolean;
};

export function buildRoute(
  name: string,
  port: number,
  options?: RouteOptions,
): HTTPRoute {
  const { subDomain, serviceName, namespace, externallyAccessible, forwardAuth } =
    options ?? {};
  const hostname = `${subDomain ?? name}${externallyAccessible ? "" : ".int"}.lab53.net`;

  const parentRefs = externallyAccessible
    ? [
        { name: "traefik-external", namespace: "traefik" },
        { name: "traefik-internal", namespace: "traefik" },
      ]
    : [{ name: "traefik-internal", namespace: "traefik" }];

  const filters = forwardAuth
    ? [
        {
          type: "ExtensionRef" as const,
          extensionRef: {
            group: "traefik.io",
            kind: "Middleware",
            name: "oidc-auth",
          },
        },
      ]
    : undefined;

  return new HTTPRoute({
    metadata: {
      name,
      namespace,
    },
    spec: {
      parentRefs,
      hostnames: [hostname],
      rules: [
        {
          filters,
          backendRefs: [
            {
              name: serviceName ?? name,
              port,
              namespace,
            },
          ],
        },
      ],
    },
  });
}

export const GENERATED_PASSWORD_GENERATOR_NAME = "generated-password";

type PasswordEncoding = "raw" | "base64" | "base64url" | "base32" | "hex";

export type GeneratedSecretKey =
  | string
  | {
      key: string;
      length?: number;
      encoding?: PasswordEncoding;
    };

const GENERATOR_API_VERSION = "generators.external-secrets.io/v1alpha1";
const DEFAULT_LENGTH = 64;
const DEFAULT_ENCODING: PasswordEncoding = "hex";

export function buildGeneratedSecret(
  name: string,
  keys: GeneratedSecretKey[],
): ResourceLike[] {
  const resources: ResourceLike[] = [];
  const dataFrom: Record<string, unknown>[] = [];

  for (const keyConfig of keys) {
    const keyName = typeof keyConfig === "string" ? keyConfig : keyConfig.key;
    const rewrite = [{ regexp: { source: "password", target: keyName } }];

    if (
      typeof keyConfig !== "string" &&
      (keyConfig.length !== undefined || keyConfig.encoding !== undefined)
    ) {
      const generatorName = `${name}-${keyName}-gen`;

      resources.push({
        apiVersion: GENERATOR_API_VERSION,
        kind: "Password",
        metadata: { name: generatorName },
        spec: {
          length: keyConfig.length ?? DEFAULT_LENGTH,
          encoding: keyConfig.encoding ?? DEFAULT_ENCODING,
          allowRepeat: true,
        },
      });

      dataFrom.push({
        sourceRef: {
          generatorRef: {
            apiVersion: GENERATOR_API_VERSION,
            kind: "Password",
            name: generatorName,
          },
        },
        rewrite,
      });
    } else {
      dataFrom.push({
        sourceRef: {
          generatorRef: {
            apiVersion: GENERATOR_API_VERSION,
            kind: "ClusterGenerator",
            name: GENERATED_PASSWORD_GENERATOR_NAME,
          },
        },
        rewrite,
      });
    }
  }

  resources.push({
    apiVersion: "external-secrets.io/v1",
    kind: "ExternalSecret",
    metadata: { name },
    spec: {
      refreshInterval: "0",
      target: { name },
      dataFrom,
    },
  });

  return resources;
}

function renderWorkload(config: WorkloadApp): string[] {
  const app = config.podSpec.securityContext
    ? config
    : {
        ...config,
        podSpec: {
          ...config.podSpec,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
          },
        },
      };

  const { name, podSpec, webPort, subDomain, externallyAccessible, forwardAuth, extraResources } = app;
  const resources: string[] = [];

  if (extraResources) {
    resources.push(...extraResources.map((r) => stringify(r)));
  }

  resources.push(stringify(buildDeployment(name, podSpec)));

  const ports = podSpec.containers.flatMap((c) => c.ports ?? []);

  if (webPort && !ports.some((p) => p.containerPort === webPort)) {
    throw new Error("Web port provided but not in pod spec");
  }

  if (ports.length > 0) {
    const service = buildService(
      name,
      ports.map((p) => ({ port: p.containerPort, name: p.name })),
    );

    resources.push(stringify(service));

    if (webPort) {
      const route = buildRoute(name, webPort, {
        subDomain,
        externallyAccessible,
        forwardAuth,
      });
      resources.push(stringify(route));
    }
  }

  return resources;
}

function renderStatic(config: StaticApp): string[] {
  return config.resources.map((r) => stringify(r));
}

export function renderAppFromConfig(config: AppConfig) {
  let resources: string[];

  switch (config.kind) {
    case "workload":
      resources = renderWorkload(config);
      break;
    case "static":
      resources = renderStatic(config);
      break;
  }

  console.log(resources.join("\n---\n"));
}
