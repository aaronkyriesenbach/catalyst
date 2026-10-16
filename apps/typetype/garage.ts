import type { ResourceLike } from "../../types";
import {
  buildFileConfigMap,
  buildHeadlessService,
  buildIscsiPvcTemplate,
  buildStatefulSet,
  image,
  readFile,
} from "../../utils";
import { DOWNLOADER_S3_CREDENTIALS_SECRET, GARAGE_RPC_SECRET } from "./secrets";
import { execCheck, readiness, startup } from "../../probes";

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

const provisionScriptName = "provision-garage.sh";
const provisionConfigMapName = "typetype-garage-provision";

const provisionConfigMap = buildFileConfigMap(provisionConfigMapName, {
  [provisionScriptName]: await readFile(
    `./${provisionScriptName}`,
    import.meta.url,
  ),
});

const garageEnv = [
  { name: "GARAGE_CONFIG_FILE", value: "/etc/garage/garage.toml" },
  {
    name: "GARAGE_RPC_SECRET",
    valueFrom: { secretKeyRef: { name: GARAGE_RPC_SECRET, key: "secret" } },
  },
];

const garageStatus = execCheck("/garage", "status");

const garageStatefulSet = buildStatefulSet(
  GARAGE_NAME,
  {
    containers: [
      {
        name: "garage",
        image: image("garage"),
        env: garageEnv,
        ports: [{ name: "s3", containerPort: GARAGE_S3_PORT }],
        readinessProbe: readiness(garageStatus),
        startupProbe: startup(garageStatus, 120),
        volumeMounts: [
          { name: "config", mountPath: "/etc/garage" },
          { name: "meta", mountPath: "/var/lib/garage/meta" },
          { name: "data", mountPath: "/var/lib/garage/data" },
        ],
      },
      {
        name: "provision",
        image: image("garage"),
        command: ["/bin/sh", `/scripts/${provisionScriptName}`],
        env: [
          ...garageEnv,
          { name: "GARAGE_BUCKET", value: GARAGE_BUCKET },
          { name: "GARAGE_KEY_NAME", value: GARAGE_KEY_NAME },
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
          {
            name: "config",
            mountPath: "/etc/garage",
            readOnly: true,
          },
          {
            name: "provision-script",
            mountPath: "/scripts",
            readOnly: true,
          },
        ],
      },
    ],
    volumes: [
      { name: "config", configMap: { name: configMapName } },
      {
        name: "provision-script",
        configMap: { name: provisionConfigMapName },
      },
    ],
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
  provisionConfigMap,
  garageStatefulSet,
  garageService,
];
