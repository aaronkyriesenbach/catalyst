import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withNasMounts,
} from "../modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "registry",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "registry:2",
        env: [
          {
            name: "REGISTRY_PROXY_REMOTEURL",
            value: "https://registry-1.docker.io",
          },
        ],
        ports: [{ name: "http", containerPort: 5000 }],
        livenessProbe: {
          httpGet: { path: "/", port: 5000 },
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/", port: 5000 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 5000,
  subDomain: "docker",
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/var/lib/registry", subPath: "cluster/registry" }],
  }),
);
