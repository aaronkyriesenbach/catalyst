import type { ResourceLike } from "../../types";
import {
  buildFileConfigMap,
  buildHeadlessService,
  buildIscsiPvcTemplate,
  buildStatefulSet,
  escapeArgoCmp,
} from "../../utils";
import { DOWNLOADER_S3_CREDENTIALS_SECRET, GARAGE_RPC_SECRET } from "./secrets";

export const GARAGE_NAME = "garage";
export const GARAGE_S3_PORT = 3900;
export const GARAGE_BUCKET = "typetype-downloads";
export const GARAGE_KEY_NAME = "typetype-downloader";

const configMapName = "typetype-garage-config";

// The provisioning sidecar reaches this node over localhost (shared pod network).
const garageToml = `
metadata_dir = "/var/lib/garage/meta"
data_dir = "/var/lib/garage/data"
db_engine = "sqlite"

replication_factor = 1

rpc_bind_addr = "[::]:3901"
rpc_public_addr = "127.0.0.1:3901"

[s3_api]
s3_region = "garage"
api_bind_addr = "[::]:3900"
`;

const garageConfigMap = buildFileConfigMap(configMapName, {
  "garage.toml": garageToml,
});

// No declarative Garage CRD exists, so this loop re-runs upstream's imperative
// setup (layout/bucket/key) every 5 minutes, converging instead of running once.
const provisionScript = escapeArgoCmp(
  [
    "while true",
    "do NODE_ID=$(/garage node id 2>/dev/null | head -n1 | cut -d@ -f1)",
    'if [ -n "$NODE_ID" ] && ! /garage layout show 2>/dev/null | sed -n "/CURRENT CLUSTER LAYOUT/,/^$/p" | grep -q "$NODE_ID"',
    'then /garage layout assign -z dc1 -c 20GB "$NODE_ID"',
    'CURRENT_VERSION=$(/garage layout show 2>/dev/null | grep -oE "Current cluster layout version: [0-9]+" | grep -oE "[0-9]+" | head -n1)',
    '/garage layout apply --version "$((${CURRENT_VERSION:-0} + 1))"',
    "fi",
    `if ! /garage bucket list 2>/dev/null | grep -q "${GARAGE_BUCKET}"`,
    `then /garage bucket create "${GARAGE_BUCKET}"`,
    "fi",
    'if ! /garage key info "$DOWNLOADER_S3_ACCESS_KEY" >/dev/null 2>&1',
    `then /garage key import --yes -n "${GARAGE_KEY_NAME}" "$DOWNLOADER_S3_ACCESS_KEY" "$DOWNLOADER_S3_SECRET_KEY"`,
    "fi",
    `/garage bucket allow --read --write --owner --key "$DOWNLOADER_S3_ACCESS_KEY" "${GARAGE_BUCKET}"`,
    "sleep 300; done",
  ].join("; "),
);

const garageEnv = [
  { name: "GARAGE_CONFIG_FILE", value: "/etc/garage/garage.toml" },
  {
    name: "GARAGE_RPC_SECRET",
    valueFrom: { secretKeyRef: { name: GARAGE_RPC_SECRET, key: "secret" } },
  },
];

const garageStatefulSet = buildStatefulSet(
  GARAGE_NAME,
  {
    containers: [
      {
        name: "garage",
        image: "dxflrs/garage:v2.2.0",
        env: garageEnv,
        ports: [{ name: "s3", containerPort: GARAGE_S3_PORT }],
        startupProbe: {
          exec: { command: ["/garage", "status"] },
          periodSeconds: 5,
          failureThreshold: 24,
        },
        readinessProbe: {
          exec: { command: ["/garage", "status"] },
          periodSeconds: 10,
          failureThreshold: 3,
        },
        volumeMounts: [
          { name: "config", mountPath: "/etc/garage" },
          { name: "meta", mountPath: "/var/lib/garage/meta" },
          { name: "data", mountPath: "/var/lib/garage/data" },
        ],
      },
      {
        name: "provision",
        image: "dxflrs/garage:v2.2.0",
        command: ["/bin/sh", "-ec", provisionScript],
        env: [
          ...garageEnv,
          {
            name: "DOWNLOADER_S3_ACCESS_KEY",
            valueFrom: {
              secretKeyRef: {
                name: DOWNLOADER_S3_CREDENTIALS_SECRET,
                key: "access_key",
              },
            },
          },
          {
            name: "DOWNLOADER_S3_SECRET_KEY",
            valueFrom: {
              secretKeyRef: {
                name: DOWNLOADER_S3_CREDENTIALS_SECRET,
                key: "secret_key",
              },
            },
          },
        ],
        volumeMounts: [
          { name: "config", mountPath: "/etc/garage", readOnly: true },
        ],
      },
    ],
    volumes: [{ name: "config", configMap: { name: configMapName } }],
    // FROM-scratch static binary: no /etc/passwd, so any UID/GID works.
    securityContext: {
      runAsNonRoot: true,
      runAsUser: 1000,
      runAsGroup: 1000,
      fsGroup: 1000,
    },
  },
  [buildIscsiPvcTemplate("meta", "5Gi"), buildIscsiPvcTemplate("data", "50Gi")],
);

const garageService = buildHeadlessService(GARAGE_NAME, [
  { name: "s3", port: GARAGE_S3_PORT },
]);

export const garageResources: ResourceLike[] = [
  garageConfigMap,
  garageStatefulSet,
  garageService,
];
