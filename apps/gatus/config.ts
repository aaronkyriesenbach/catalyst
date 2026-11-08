import { StatusGroup, type StatusTarget } from "@catalyst/platform/status";
import { customAlert } from "./alerting";
import { endpointKey, gatusPort, heartbeatTokenEnv } from "./common";

export type Heartbeat = {
  name: string;
  interval: string;
};

const hiddenDetails = {
  "hide-url": true,
  "hide-hostname": true,
  "hide-port": true,
  "hide-errors": true,
  "hide-conditions": true,
};

function buildEndpoint(target: StatusTarget) {
  const client = {
    ...(target.insecure && { insecure: true }),
    ...(target.ignoreRedirect && { "ignore-redirect": true }),
    ...(target.dnsResolver && { "dns-resolver": target.dnsResolver }),
  };

  return {
    name: target.name,
    group: target.group,
    url: target.url,
    interval: target.interval ?? "1m",
    conditions: target.conditions,
    ...(target.dns && {
      dns: {
        "query-type": target.dns.queryType,
        "query-name": target.dns.queryName,
      },
    }),
    ...(Object.keys(client).length > 0 && { client }),
    ui: hiddenDetails,
    alerts: [customAlert],
  };
}

function buildExternalEndpoint(heartbeat: Heartbeat) {
  return {
    name: heartbeat.name,
    group: StatusGroup.Certificates,
    token: `\${${heartbeatTokenEnv}}`,
    heartbeat: { interval: heartbeat.interval },
    alerts: [{ ...customAlert, "failure-threshold": 1 }],
  };
}

function assertUniqueKeys(targets: readonly StatusTarget[]): void {
  const seen = new Set<string>();

  for (const { group, name } of targets) {
    const key = endpointKey(group, name);

    if (seen.has(key)) {
      throw new Error(`Duplicate status check '${key}'`);
    }
    seen.add(key);
  }
}

export function buildGatusConfig(
  targets: readonly StatusTarget[],
  heartbeats: readonly Heartbeat[],
  extra: { storagePath: string; alerting: unknown },
) {
  assertUniqueKeys(targets);

  return {
    web: { port: gatusPort },
    storage: { type: "postgres", path: extra.storagePath, caching: true },
    ui: {
      title: "Lab53 Status",
      header: "Lab53 Status",
      description: "Live status of the services running on lab53.net",
      "dashboard-heading": "Services",
      "dashboard-subheading": "Live health of everything running on lab53.net",
      "default-sort-by": "group",
    },
    concurrency: 10,
    alerting: extra.alerting,
    endpoints: targets.map(buildEndpoint),
    "external-endpoints": heartbeats.map(buildExternalEndpoint),
  };
}
