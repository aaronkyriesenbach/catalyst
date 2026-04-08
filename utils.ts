import { Deployment } from "kubernetes-models/apps/v1";
import type { IPodSpec, IServicePort } from "kubernetes-models/v1";
import { Service } from "kubernetes-models/v1";
import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { stringify } from "yaml";
import type { AppConfig, StaticApp, WorkloadApp } from "./types";

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
};

export function buildRoute(
  name: string,
  port: number,
  options?: RouteOptions,
): HTTPRoute {
  const { subDomain, serviceName, namespace, externallyAccessible } =
    options ?? {};
  const hostname = `${subDomain ?? name}${externallyAccessible ? "" : ".int"}.lab53.net`;

  const parentRefs = externallyAccessible
    ? [
        { name: "traefik-external", namespace: "traefik" },
        { name: "traefik-internal", namespace: "traefik" },
      ]
    : [{ name: "traefik-internal", namespace: "traefik" }];

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

function renderWorkload(config: WorkloadApp): string[] {
  const { name, podSpec, webPort, subDomain, externallyAccessible } = config;
  const resources: string[] = [];

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
