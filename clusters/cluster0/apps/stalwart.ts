import {
  applyModifiers,
  withIscsiVolumes,
  withOidcPublicClient,
} from "@catalyst/platform/modifiers";
import { httpCheck, readiness, startup } from "@catalyst/k8s/probes";
import { buildFileConfigMap } from "@catalyst/k8s/workload";
import { appHostname, appUrl } from "@catalyst/platform/hostnames";
import { httpTarget, serviceUrl, StatusGroup } from "@catalyst/platform/status";
import type { WorkloadApp } from "@catalyst/core/types";
import { image } from "@catalyst/versions/images";
import {
  recoveryAdminSecretName,
  stalwartName,
  stalwartPort,
  webUiRedirectPaths,
} from "./stalwart/common";
import { stalwartConfigResources } from "./stalwart/config-job";

const configMapName = `${stalwartName}-config-json`;
const STARTUP_BUDGET_SECONDS = 300;
const STALWART_UID = 2000;

const dataStore = buildFileConfigMap(configMapName, {
  "config.json": JSON.stringify({
    "@type": "RocksDb",
    path: "/var/lib/stalwart/",
  }),
});

const base: WorkloadApp = {
  kind: "workload",
  name: stalwartName,
  podSpec: {
    securityContext: {
      runAsNonRoot: true,
      runAsUser: STALWART_UID,
      runAsGroup: STALWART_UID,
      fsGroup: STALWART_UID,
      fsGroupChangePolicy: "OnRootMismatch",
      seccompProfile: { type: "RuntimeDefault" },
    },
    containers: [
      {
        name: "main",
        image: image("stalwart"),
        args: ["--config", "/etc/stalwart/config.json"],
        env: [
          { name: "STALWART_HOSTNAME", value: stalwartName },
          { name: "STALWART_PUBLIC_URL", value: appUrl(stalwartName) },
          {
            name: "STALWART_RECOVERY_ADMIN",
            valueFrom: {
              secretKeyRef: {
                name: recoveryAdminSecretName,
                key: "STALWART_RECOVERY_ADMIN",
              },
            },
          },
        ],
        ports: [{ name: "http", containerPort: stalwartPort }],
        resources: {
          requests: { cpu: "50m", memory: "256Mi" },
          limits: { cpu: "2", memory: "1Gi" },
        },
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"], add: ["NET_BIND_SERVICE"] },
        },
        startupProbe: startup(
          httpCheck("/healthz/ready", stalwartPort),
          STARTUP_BUDGET_SECONDS,
        ),
        readinessProbe: readiness(httpCheck("/healthz/ready", stalwartPort)),
        livenessProbe: {
          ...httpCheck("/healthz/live", stalwartPort),
          periodSeconds: 30,
          failureThreshold: 3,
        },
        volumeMounts: [
          { name: "config", mountPath: "/etc/stalwart", readOnly: true },
          { name: "tmp", mountPath: "/tmp" },
          { name: "log", mountPath: "/var/log/stalwart" },
        ],
      },
    ],
    volumes: [
      { name: "config", configMap: { name: configMapName } },
      { name: "tmp", emptyDir: {} },
      { name: "log", emptyDir: {} },
    ],
  },
  webPort: stalwartPort,
  progressDeadlineSeconds: 600,
  extraResources: [dataStore, ...stalwartConfigResources],
  status: {
    targets: [
      httpTarget(
        "Stalwart",
        StatusGroup.Apps,
        serviceUrl(stalwartName, stalwartName, stalwartPort, "/healthz/ready"),
      ),
      {
        ...httpTarget(
          "Stalwart",
          StatusGroup.Routes,
          `https://${appHostname(stalwartName)}/healthz/ready`,
        ),
        conditions: ["[STATUS] < 400", "[CERTIFICATE_EXPIRATION] > 168h"],
      },
    ],
  },
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      {
        name: "data",
        mountPath: "/var/lib/stalwart",
        storageRequest: "5Gi",
        backup: true,
        backupOwner: STALWART_UID,
      },
    ],
  }),
  withOidcPublicClient({ redirectPaths: webUiRedirectPaths }),
);
