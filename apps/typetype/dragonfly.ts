import type { ResourceLike } from "../../types";
import { buildDeployment, buildService, image } from "../../utils";
import { execCheck, readiness } from "../../probes";

export const DRAGONFLY_NAME = "dragonfly";
export const DRAGONFLY_PORT = 6379;

const deployment = buildDeployment(DRAGONFLY_NAME, {
  containers: [
    {
      name: "dragonfly",
      image: image("dragonfly"),
      ports: [{ name: "redis", containerPort: DRAGONFLY_PORT }],
      // Dragonfly wants unlimited locked memory for its shared-memory data store.
      securityContext: { capabilities: { add: ["IPC_LOCK"] } },
      readinessProbe: readiness(execCheck("redis-cli", "ping")),
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
