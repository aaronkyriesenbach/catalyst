import { applyModifiers, withForwardAuth } from "@catalyst/platform/modifiers";
import type { WorkloadApp } from "@catalyst/core/types";
import { image } from "@catalyst/versions/images";
import { httpCheck, readiness } from "@catalyst/k8s/probes";

const base: WorkloadApp = {
  kind: "workload",
  name: "calino",
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("calino"),
        ports: [{ name: "http", containerPort: 8080 }],
        livenessProbe: {
          httpGet: { path: "/", port: 8080 },
          initialDelaySeconds: 5,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: readiness(httpCheck("/", 8080)),
      },
    ],
  },
  webPort: 8080,
  subDomain: "calendar",
};

export default applyModifiers(base, withForwardAuth());
