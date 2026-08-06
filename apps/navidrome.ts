import { applyModifiers, withIscsiVolumes, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "navidrome",
  subDomain: "music",
  externallyAccessible: true,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/navidrome/navidrome:0.62.0",
        ports: [{ name: "http", containerPort: 4533 }],
        env: [
          { name: "ND_MUSICFOLDER", value: "/music" },
          { name: "ND_SCANONSCHEDULE", value: "0 0 */6 * *" },
          { name: "ND_ENFORCENONROOTUSER", value: "true" },
        ],
        livenessProbe: {
          httpGet: { path: "/ping", port: 4533 },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/ping", port: 4533 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 4533,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [{ name: "data", mountPath: "/data", storageRequest: "10Gi" }],
  }),
  withNasMounts({
    main: [{ mountPath: "/music", subPath: "music" }],
  }),
);
