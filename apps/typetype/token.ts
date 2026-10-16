import type { ResourceLike } from "../../types";
import { buildDeployment, buildService, image } from "../../utils";
import { YOUTUBE_REMOTE_LOGIN_TOKEN_SECRET } from "./secrets";
import { httpCheck, readiness, startup } from "../../probes";

export const TOKEN_NAME = "typetype-token";
export const TOKEN_PORT = 8081;

const deployment = buildDeployment(TOKEN_NAME, {
  containers: [
    {
      name: "main",
      image: image("typetypeToken"),
      ports: [{ name: "http", containerPort: TOKEN_PORT }],
      env: [
        { name: "NODE_ENV", value: "production" },
        { name: "YOUTUBE_REMOTE_LOGIN_ENABLED", value: "true" },
        {
          name: "YOUTUBE_REMOTE_LOGIN_INTERNAL_TOKEN",
          valueFrom: {
            secretKeyRef: {
              name: YOUTUBE_REMOTE_LOGIN_TOKEN_SECRET,
              key: "token",
            },
          },
        },
        {
          name: "YOUTUBE_REMOTE_LOGIN_CALLBACK_ORIGIN",
          value: "http://typetype-server:8080",
        },
        { name: "YOUTUBE_REMOTE_LOGIN_MAX_SESSIONS", value: "2" },
        { name: "YOUTUBE_REMOTE_LOGIN_FRAME_FPS", value: "10" },
        {
          name: "YOUTUBE_REMOTE_LOGIN_MAX_FRAME_BYTES",
          value: "524288",
        },
      ],
      readinessProbe: readiness(httpCheck("/health", TOKEN_PORT)),
      startupProbe: startup(httpCheck("/health", TOKEN_PORT), 120),
      // Chromium needs real /dev/shm; a sized tmpfs avoids upstream's `ipc: host` (host IPC namespace escalation).
      volumeMounts: [{ name: "dshm", mountPath: "/dev/shm" }],
      resources: {
        requests: { cpu: "250m", memory: "512Mi" },
        limits: { memory: "1500Mi" },
      },
    },
  ],
  volumes: [{ name: "dshm", emptyDir: { medium: "Memory", sizeLimit: "1Gi" } }],
  // Non-root Chromium isn't a validated config upstream (breaks its home-dir assumptions); left at image default.
});

const service = buildService(TOKEN_NAME, [{ name: "http", port: TOKEN_PORT }]);

export const tokenResources: ResourceLike[] = [deployment, service];
