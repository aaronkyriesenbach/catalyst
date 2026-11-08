import { stringify } from "yaml";
import {
  authentikHostOptions,
  authentikNamespace,
  authentikServiceName,
  authentikServicePort,
} from "../auth";
import { applyModifiers, withPostgres } from "../modifiers";
import { httpCheck, readiness, startup } from "../probes";
import {
  httpTarget,
  resolveStatusTargets,
  routeTargets,
  serviceUrl,
  StatusGroup,
  type StatusTarget,
} from "../status";
import type { WorkloadApp } from "../types";
import {
  buildFileConfigMap,
  buildGeneratedSecret,
  image,
  loadAllAppConfigs,
} from "../utils";
import { buildAlerting } from "./gatus/alerting";
import {
  gatusName,
  gatusPort,
  heartbeatSecretKey,
  heartbeatSecretName,
  heartbeatTokenEnv,
} from "./gatus/common";
import { buildGatusConfig, type Heartbeat } from "./gatus/config";
import { externalApps } from "./traefik/externalApps.config";

const configMapName = `${gatusName}-config`;
const configFile = "config.yaml";
const configDir = "/config";
const health = httpCheck("/health", gatusPort);

const HEARTBEAT_INTERVAL = "3h";

const aggregatingApps = ["authentik.ts", "limit-ranges.ts", `${gatusName}.ts`];

const manualTargets: StatusTarget[] = [
  httpTarget(
    "Authentik",
    StatusGroup.Platform,
    serviceUrl(
      authentikServiceName,
      authentikNamespace,
      authentikServicePort,
      "/-/health/live/",
    ),
  ),
  ...routeTargets("Authentik", "authentik", authentikHostOptions),
];

const appConfigs = await loadAllAppConfigs(aggregatingApps);
const targets = [...appConfigs.flatMap(resolveStatusTargets), ...manualTargets];

const heartbeats: Heartbeat[] = externalApps
  .filter((app) => app.certDeploy !== undefined)
  .map((app) => ({
    name: `${app.name}-cert-deploy`,
    interval: HEARTBEAT_INTERVAL,
  }));

const gatusConfig = buildGatusConfig(targets, heartbeats, {
  storagePath: `postgres://${gatusName}:${gatusName}@${gatusName}-postgres:5432/${gatusName}?sslmode=disable`,
  alerting: buildAlerting(),
});

const configMap = buildFileConfigMap(configMapName, {
  [configFile]: stringify(gatusConfig, {
    version: "1.1",
    aliasDuplicateObjects: false,
  }),
});

const base: WorkloadApp = {
  kind: "workload",
  name: gatusName,
  subDomain: "status",
  externallyAccessible: true,
  status: { group: StatusGroup.Platform },
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("gatus"),
        resources: {
          requests: { cpu: "50m", memory: "128Mi" },
          limits: { memory: "512Mi" },
        },
        env: [
          { name: "GATUS_CONFIG_PATH", value: `${configDir}/${configFile}` },
          {
            name: heartbeatTokenEnv,
            valueFrom: {
              secretKeyRef: {
                name: heartbeatSecretName,
                key: heartbeatSecretKey,
              },
            },
          },
        ],
        ports: [{ name: "http", containerPort: gatusPort }],
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"] },
          seccompProfile: { type: "RuntimeDefault" },
        },
        volumeMounts: [
          { name: "config", mountPath: configDir, readOnly: true },
        ],
        startupProbe: startup(health, 120),
        livenessProbe: {
          ...health,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: readiness(health),
      },
    ],
    volumes: [{ name: "config", configMap: { name: configMapName } }],
  },
  webPort: gatusPort,
  strategy: { type: "Recreate" },
  extraResources: [
    configMap,
    ...buildGeneratedSecret(
      gatusName,
      heartbeatSecretName,
      [{ key: heartbeatSecretKey, length: 40, alphanumeric: true }],
      { persist: true },
    ),
  ],
};

export default applyModifiers(base, withPostgres(17, { backup: true }));
