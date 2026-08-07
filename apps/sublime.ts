import { applyModifiers, withIscsiVolumes, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildAwsExternalSecret, buildFileConfigMap, readFile } from "../utils";

const name = "sublime";
const configConfigMapName = `${name}-config`;
const opensubtitlesSecretName = `${name}-opensubtitles-credentials`;
const subdlSecretName = `${name}-subdl-credentials`;

const configConfigMap = buildFileConfigMap(configConfigMapName, {
  "config.yaml": await readFile("./sublime/config.yaml", import.meta.url),
});

const opensubtitlesSecret = buildAwsExternalSecret(opensubtitlesSecretName, [
  {
    remoteKey: "lab53/cluster0/sublime/opensubtitles-credentials",
    property: "API_KEY",
    secretKey: "API_KEY",
  },
  {
    remoteKey: "lab53/cluster0/sublime/opensubtitles-credentials",
    property: "USERNAME",
    secretKey: "USERNAME",
  },
  {
    remoteKey: "lab53/cluster0/sublime/opensubtitles-credentials",
    property: "PASSWORD",
    secretKey: "PASSWORD",
  },
]);

const subdlSecret = buildAwsExternalSecret(subdlSecretName, [
  {
    remoteKey: "lab53/cluster0/sublime/subdl-credentials",
    property: "API_KEY",
    secretKey: "API_KEY",
  },
]);

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/aaronkyriesenbach/sublime:0.3.0",
        env: [
          {
            name: "SUBLIME_OPENSUBTITLES_API_KEY",
            valueFrom: {
              secretKeyRef: { name: opensubtitlesSecretName, key: "API_KEY" },
            },
          },
          {
            name: "SUBLIME_OPENSUBTITLES_USERNAME",
            valueFrom: {
              secretKeyRef: { name: opensubtitlesSecretName, key: "USERNAME" },
            },
          },
          {
            name: "SUBLIME_OPENSUBTITLES_PASSWORD",
            valueFrom: {
              secretKeyRef: { name: opensubtitlesSecretName, key: "PASSWORD" },
            },
          },
          {
            name: "SUBLIME_SUBDL_API_KEY",
            valueFrom: {
              secretKeyRef: { name: subdlSecretName, key: "API_KEY" },
            },
          },
        ],
        volumeMounts: [
          { name: "config", mountPath: "/config", readOnly: true },
        ],
      },
    ],
    volumes: [{ name: "config", configMap: { name: configConfigMapName } }],
  },
  extraResources: [configConfigMap, opensubtitlesSecret, subdlSecret],
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [{ name: "data", mountPath: "/data", backup: true }],
  }),
  withNasMounts({
    main: [
      { mountPath: "/movies", subPath: "movies" },
      { mountPath: "/tv", subPath: "tv" },
    ],
  }),
);
