import type { ResourceLike } from "../../types";
import { buildDeployment, buildService } from "../../utils";

export const DRAGONFLY_NAME = "dragonfly";
export const DRAGONFLY_PORT = 6379;

const deployment = buildDeployment(DRAGONFLY_NAME, {
  containers: [
    {
      name: "dragonfly",
      image: "docker.dragonflydb.io/dragonflydb/dragonfly:v1.39.0",
      ports: [{ name: "redis", containerPort: DRAGONFLY_PORT }],
      // Dragonfly wants unlimited locked memory for its shared-memory data store.
      securityContext: { capabilities: { add: ["IPC_LOCK"] } },
      readinessProbe: {
        exec: { command: ["redis-cli", "ping"] },
        periodSeconds: 10,
        failureThreshold: 3,
      },
    },
  ],
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 1000,
    runAsGroup: 1000,
    fsGroup: 1000,
  },
});

const service = buildService(DRAGONFLY_NAME, [
  { name: "redis", port: DRAGONFLY_PORT },
]);

export const dragonflyResources: ResourceLike[] = [deployment, service];
