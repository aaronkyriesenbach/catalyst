import {
  ExternalSecret,
  type IExternalSecretData,
} from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { httpCheck, readiness } from "../probes";
import type { WorkloadApp } from "../types";
import { AWS_STORE, awsRemoteKey, image, readFile } from "../utils";

const name = "apprise";
const port = 8000;
const configSecretName = `${name}-config`;

// No HTTPRoute exists on purpose: Apprise has no auth, so it stays in-cluster.
export const appriseUrl = `http://${name}.${name}.svc:${port}`;

// Simple stateful mode reads /config/<key>.yml, one file per notifying app.
export const appriseNotifiers = [
  "external-cert-deployer",
  "healthchecks",
  "victoria-metrics",
];

const pushoverSecret = awsRemoteKey(name, "pushover-credentials");
const sesSecret = awsRemoteKey(name, "ses-credentials");

// Underscores: these are Go template identifiers.
const credentialData: IExternalSecretData[] = [
  {
    secretKey: "pushover_user_key",
    key: pushoverSecret,
    property: "user-key",
  },
  {
    secretKey: "pushover_app_token",
    key: pushoverSecret,
    property: "app-token",
  },
  {
    secretKey: "ses_access_key_id",
    key: sesSecret,
    property: "access-key-id",
  },
  {
    secretKey: "ses_secret_access_key",
    key: sesSecret,
    property: "secret-access-key",
  },
  { secretKey: "ses_region", key: sesSecret, property: "region" },
  { secretKey: "ses_from", key: sesSecret, property: "from" },
  { secretKey: "ses_to", key: sesSecret, property: "to" },
].map(({ secretKey, key, property }) => ({
  secretKey,
  remoteRef: { key, property },
}));

const notifierTemplate = await readFile(
  "./apprise/notifier.yml",
  import.meta.url,
);

const configSecret = new ExternalSecret({
  metadata: { name: configSecretName },
  spec: {
    refreshInterval: "1h",
    secretStoreRef: AWS_STORE,
    target: {
      name: configSecretName,
      template: {
        engineVersion: "v2",
        data: Object.fromEntries(
          appriseNotifiers.map((notifier) => [
            `${notifier}.yml`,
            notifierTemplate,
          ]),
        ),
      },
    },
    data: credentialData,
  },
});

const config: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("apprise"),
        env: [
          { name: "APPRISE_STATEFUL_MODE", value: "simple" },
          { name: "APPRISE_CONFIG_LOCK", value: "true" },
          { name: "APPRISE_API_ONLY", value: "true" },
          // Default store is under the read-only /config; /status would fail.
          { name: "APPRISE_STORAGE_DIR", value: "" },
          { name: "APPRISE_ATTACH_SIZE", value: "0" },
          { name: "APPRISE_WORKER_COUNT", value: "2" },
        ],
        ports: [{ name: "http", containerPort: port }],
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: { drop: ["ALL"] },
        },
        volumeMounts: [
          { name: "config", mountPath: "/config", readOnly: true },
          { name: "tmp", mountPath: "/tmp" },
        ],
        livenessProbe: {
          httpGet: { path: "/status", port },
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: readiness(httpCheck("/status", port)),
      },
    ],
    volumes: [
      { name: "config", secret: { secretName: configSecretName } },
      { name: "tmp", emptyDir: {} },
    ],
  },
  extraResources: [configSecret],
};

export default config;
