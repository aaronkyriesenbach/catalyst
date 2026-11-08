import { stringify } from "yaml";
import { applyModifiers, withPostgres } from "@catalyst/platform/modifiers";
import { httpCheck, readiness, startup } from "@catalyst/k8s/probes";
import { resolveStatusTargets, StatusGroup } from "@catalyst/platform/status";
import type { AppConfig, WorkloadApp } from "@catalyst/core/types";
import { buildFileConfigMap } from "@catalyst/k8s/workload";
import { buildGeneratedSecret } from "@catalyst/k8s/secrets";
import { image } from "@catalyst/versions/images";
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

const heartbeats: Heartbeat[] = externalApps
  .filter((app) => app.certDeploy !== undefined)
  .map((app) => ({
    name: `${app.name}-cert-deploy`,
    interval: HEARTBEAT_INTERVAL,
  }));

function buildConfigMap(configs: readonly AppConfig[]) {
  const targets = configs
    .filter((config) => config.name !== gatusName)
    .flatMap(resolveStatusTargets);
  const gatusConfig = buildGatusConfig(targets, heartbeats, {
    storagePath: `postgres://${gatusName}:${gatusName}@${gatusName}-postgres:5432/${gatusName}?sslmode=disable`,
    alerting: buildAlerting(),
  });

  return buildFileConfigMap(configMapName, {
    [configFile]: stringify(gatusConfig, {
      version: "1.1",
      aliasDuplicateObjects: false,
    }),
  });
}

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
    ...buildGeneratedSecret(
      gatusName,
      heartbeatSecretName,
      [{ key: heartbeatSecretKey, length: 40, alphanumeric: true }],
      { persist: true },
    ),
  ],
  derive: ({ catalog, cluster }) => ({
    extraResources: [buildConfigMap(catalog.onCluster(cluster))],
  }),
};

export default applyModifiers(base, withPostgres(17, { backup: true }));
