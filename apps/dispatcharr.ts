import type { WorkloadApp } from "@catalyst/core/types";
import { image } from "@catalyst/versions/images";
import { httpCheck, readiness } from "@catalyst/k8s/probes";
import { applyModifiers, withIscsiVolumes } from "@catalyst/platform/modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "dispatcharr",
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("dispatcharr"),
        resources: {
          requests: { cpu: "50m", memory: "512Mi" },
          limits: { memory: "2Gi" },
        },
        ports: [{ name: "http", containerPort: 9191 }],
        env: [
          { name: "DISPATCHARR_ENV", value: "aio" },
          { name: "REDIS_HOST", value: "localhost" },
          { name: "CELERY_BROKER_URL", value: "redis://localhost:6379/0" },
          { name: "DISPATCHARR_LOG_LEVEL", value: "info" },
        ],
        livenessProbe: {
          httpGet: { path: "/", port: 9191 },
          initialDelaySeconds: 5,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: readiness(httpCheck("/", 9191)),
      },
    ],
    // TEMP: tighten this up once it's working
    securityContext: {},
  },
  webPort: 9191,
  subDomain: "dispatcharr",
};

export default applyModifiers(
  base,
  withIscsiVolumes({ main: [{ name: "data", mountPath: "/data" }] }),
);
