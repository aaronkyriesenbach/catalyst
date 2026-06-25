import {
  applyModifiers,
  withIscsiVolumes,
  withNasMounts,
  withOidcAuth,
} from "../modifiers";
import type { WorkloadApp } from "../types";

const name = "sublarr";

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/abrechen2/sublarr:1.2.0",
        ports: [{ name: "http", containerPort: 5765 }],
        env: [
          {
            // This should be the default but the image has a bug that causes startup to fail without it set.
            name: "SUBLARR_PORT",
            value: "5765",
          },
          {
            name: "SUBLARR_CORS_ORIGINS",
            value: "http://localhost:5765,https://sublarr.int.lab53.net",
          },
        ],
        livenessProbe: {
          httpGet: { path: "/api/v1/health", port: 5765 },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/api/v1/health", port: 5765 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
    securityContext: {}, // Override to allow running as root; container switches to 1000 itself
  },
  webPort: 5765,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      {
        name: "config",
        mountPath: "/config",
        storageRequest: "5Gi",
        backup: true,
      },
    ],
  }),
  withNasMounts({
    main: [
      { mountPath: "/movies", subPath: "movies" },
      { mountPath: "/tv", subPath: "tv" },
    ],
  }),
  withOidcAuth({
    middleware: {
      enabled: true,
      bypassPaths: [{ type: "prefix", path: "/socket.io/" }],
    },
  }),
);
