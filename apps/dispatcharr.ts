import type { WorkloadApp } from "../types";
import { image } from "../utils";
import { httpCheck, readiness } from "../probes";

const base: WorkloadApp = {
  kind: "workload",
  name: "dispatcharr",
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("dispatcharr"),
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
  },
  webPort: 9191,
  subDomain: "dispatcharr",
};

export default base;
