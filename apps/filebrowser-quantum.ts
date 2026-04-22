import { ConfigMap } from "kubernetes-models/v1";
import { applyModifiers, withNasMounts, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";
import { readFile } from "../utils";

const name = "filebrowser-quantum";
const oidcCredentialsSecret = `${name}-oidc-credentials`;

const configMap = new ConfigMap({
  metadata: { name },
  data: {
    "config.yaml": await readFile(
      "./filebrowser-quantum/config.yaml",
      import.meta.url,
    ),
  },
});

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/gtsteffaniak/filebrowser:1.3.0-stable",
        env: [
          { name: "FILEBROWSER_CONFIG", value: "/config/config.yaml" },
          {
            name: "FILEBROWSER_OIDC_CLIENT_ID",
            valueFrom: {
              secretKeyRef: {
                name: oidcCredentialsSecret,
                key: "client_id",
              },
            },
          },
          {
            name: "FILEBROWSER_OIDC_CLIENT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: oidcCredentialsSecret,
                key: "client_secret",
              },
            },
          },
        ],
        ports: [{ name: "http", containerPort: 80 }],
        volumeMounts: [
          { name: "config", mountPath: "/config", readOnly: true },
        ],
        livenessProbe: {
          httpGet: { path: "/health", port: 80 },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/health", port: 80 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
    volumes: [{ name: "config", configMap: { name } }],
  },
  webPort: 80,
  subDomain: "files",
  externallyAccessible: true,
  extraResources: [configMap],
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [
      {
        mountPath: "/home/filebrowser/data",
        subPath: "cluster/filebrowser-quantum/data",
      },
      { mountPath: "/srv/data" },
    ],
  }),
  withOidcAuth(),
);
