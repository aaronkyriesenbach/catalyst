import type { IContainer, IProbe } from "kubernetes-models/v1";
import { appHostname, type HostOptions } from "./hostnames";
import type { AppConfig, WorkloadApp } from "./types";

export enum StatusGroup {
  Apps = "Apps",
  Media = "Media",
  Platform = "Platform",
  Infrastructure = "Infrastructure",
  Routes = "Routes",
  Public = "Public",
  Certificates = "Certificates",
}

export type StatusTarget = {
  name: string;
  group: StatusGroup;
  url: string;
  conditions: readonly string[];
  interval?: string;
  insecure?: boolean;
  ignoreRedirect?: boolean;
  dnsResolver?: string;
  dns?: { queryType: string; queryName: string };
};

export type StatusDeclaration =
  | { exempt: string }
  | {
      group?: StatusGroup;
      title?: string;
      targets?: readonly StatusTarget[];
    };

const PUBLIC_RESOLVER = "tcp://1.1.1.1:53";
const PUBLIC_INTERVAL = "5m";
const PROBE_HEALTHY = "[STATUS] < 400";
const CONNECTED = "[CONNECTED] == true";
const ROUTE_CONDITIONS = [
  "[STATUS] < 500",
  "[STATUS] != 404",
  "[CERTIFICATE_EXPIRATION] > 168h",
] as const;

export function titleCase(name: string): string {
  return name
    .split("-")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function serviceUrl(
  service: string,
  namespace: string,
  port: number,
  path = "",
): string {
  return `http://${service}.${namespace}.svc:${port}${path}`;
}

export function httpTarget(
  name: string,
  group: StatusGroup,
  url: string,
  options?: Pick<StatusTarget, "insecure" | "interval">,
): StatusTarget {
  return { name, group, url, conditions: [PROBE_HEALTHY], ...options };
}

export function tcpTarget(
  name: string,
  group: StatusGroup,
  host: string,
  port: number,
): StatusTarget {
  return { name, group, url: `tcp://${host}:${port}`, conditions: [CONNECTED] };
}

export function dnsTarget(
  name: string,
  server: string,
  queryName: string,
): StatusTarget {
  return {
    name,
    group: StatusGroup.Infrastructure,
    url: server,
    conditions: ["[DNS_RCODE] == NOERROR"],
    dns: { queryType: "A", queryName },
  };
}

export function routeTargets(
  title: string,
  name: string,
  host: HostOptions,
): StatusTarget[] {
  const target: StatusTarget = {
    name: title,
    group: StatusGroup.Routes,
    url: `https://${appHostname(name, host)}`,
    conditions: ROUTE_CONDITIONS,
    ignoreRedirect: true,
  };

  return host.externallyAccessible
    ? [
        target,
        {
          ...target,
          group: StatusGroup.Public,
          dnsResolver: PUBLIC_RESOLVER,
          interval: PUBLIC_INTERVAL,
        },
      ]
    : [target];
}

function webContainer(app: WorkloadApp, port: number): IContainer | undefined {
  return app.podSpec.containers.find((container) =>
    container.ports?.some(
      (containerPort) => containerPort.containerPort === port,
    ),
  );
}

function probesWebPort(
  probe: IProbe | undefined,
  container: IContainer,
  port: number,
): probe is IProbe {
  const target = probe?.httpGet?.port;
  const portName = container.ports?.find(
    (containerPort) => containerPort.containerPort === port,
  )?.name;

  return target === port || (portName !== undefined && target === portName);
}

function workloadServiceTarget(
  app: WorkloadApp,
  port: number,
  title: string,
  group: StatusGroup,
): StatusTarget {
  const namespace = app.namespace ?? app.name;
  const container = webContainer(app, port);
  const probe = container?.readinessProbe;

  if (container && probesWebPort(probe, container, port) && probe.httpGet) {
    const https = probe.httpGet.scheme === "HTTPS";
    const path = probe.httpGet.path ?? "/";
    const url = serviceUrl(app.name, namespace, port, path);

    return httpTarget(
      title,
      group,
      https ? url.replace("http:", "https:") : url,
      {
        insecure: https,
      },
    );
  }

  return tcpTarget(title, group, `${app.name}.${namespace}.svc`, port);
}

function deriveWorkloadTargets(
  app: WorkloadApp,
  port: number,
  title: string,
  group: StatusGroup,
): StatusTarget[] {
  return [
    workloadServiceTarget(app, port, title, group),
    ...routeTargets(title, app.name, {
      subDomain: app.subDomain,
      externallyAccessible: app.externallyAccessible,
    }),
  ];
}

export function resolveStatusTargets(config: AppConfig): StatusTarget[] {
  const declaration = config.status;

  if (config.autoSync === false) {
    return [];
  }

  if (declaration !== undefined && "exempt" in declaration) {
    return [];
  }

  if (declaration?.targets !== undefined) {
    return [...declaration.targets];
  }

  if (config.kind === "workload" && config.webPort !== undefined) {
    return deriveWorkloadTargets(
      config,
      config.webPort,
      declaration?.title ?? titleCase(config.name),
      declaration?.group ?? StatusGroup.Apps,
    );
  }

  throw new Error(
    `App '${config.name}' has no web port to derive a status check from: declare status.targets or status.exempt`,
  );
}
