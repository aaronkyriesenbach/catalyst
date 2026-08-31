import { applyModifiers, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "calino",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/ivan-malinovski/calino:0.33.0",
        ports: [{ name: "http", containerPort: 8080 }],
        livenessProbe: {
          httpGet: { path: "/", port: 8080 },
          initialDelaySeconds: 5,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/", port: 8080 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 8080,
  subDomain: "calendar",
};

export default applyModifiers(
  base,
  withOidcAuth({ middleware: { enabled: true } }),
);
