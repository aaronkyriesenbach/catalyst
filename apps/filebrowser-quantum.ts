import { ConfigMap } from "kubernetes-models/v1";
import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withNasMounts,
} from "../modifiers";

const name = "filebrowser-quantum";

const configMap = new ConfigMap({
  metadata: { name },
  data: {
    "config.yaml": await Bun.file(
      new URL("./filebrowser-quantum/config.yaml", import.meta.url),
    ).text(),
  },
});

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/gtsteffaniak/filebrowser:1.2.4-stable",
        env: [
          { name: "FILEBROWSER_CONFIG", value: "/config/config.yaml" },
          {
            name: "FILEBROWSER_OIDC_CLIENT_ID",
            valueFrom: {
              secretKeyRef: {
                name: "filebrowser-quantum-oidc",
                key: "client-id",
              },
            },
          },
          {
            name: "FILEBROWSER_OIDC_CLIENT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: "filebrowser-quantum-oidc",
                key: "client-secret",
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
);
