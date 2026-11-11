import {
  applyModifiers,
  withIscsiVolumes,
  withNasMounts,
} from "@catalyst/platform/modifiers";
import type { WorkloadApp } from "@catalyst/core/types";
import { image } from "@catalyst/versions/images";
import { httpCheck, readiness } from "@catalyst/k8s/probes";

const base: WorkloadApp = {
  kind: "workload",
  name: "navidrome",
  replicas: 0,
  status: { exempt: "Scaled to 0 replicas" },
  subDomain: "music",
  externallyAccessible: true,
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("navidrome"),
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
        readinessProbe: readiness(httpCheck("/ping", 4533)),
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
    main: [{ mountPath: "/music", subPath: "media/music" }],
  }),
);
