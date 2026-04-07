import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withNasMounts,
  withSecurityDefaults,
} from "../modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "pocket-id",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/pocket-id/pocket-id:v2",
        env: [
          { name: "APP_URL", value: "https://auth.lab53.net" },
          {
            name: "ENCRYPTION_KEY",
            valueFrom: {
              secretKeyRef: {
                name: "pocket-id",
                key: "encryption-key",
              },
            },
          },
          { name: "TRUST_PROXY", value: "true" },
          { name: "PUID", value: "1000" },
          { name: "PGID", value: "1000" },
        ],
        ports: [{ name: "http", containerPort: 1411 }],
        livenessProbe: {
          exec: { command: ["/app/pocket-id", "healthcheck"] },
          initialDelaySeconds: 10,
          periodSeconds: 90,
          timeoutSeconds: 5,
          failureThreshold: 2,
        },
      },
    ],
  },
  webPort: 1411,
  subDomain: "auth",
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withSecurityDefaults(1000),
  withNasMounts({
    main: [{ mountPath: "/app/data", subPath: "cluster/pocket-id/data" }],
  }),
);
