import { httpCheck, readiness, startup } from "../../probes";
import type { ResourceLike } from "../../types";
import { buildDeployment, buildService, image } from "../../utils";
import { podSecurityContext, restrictedContainer, timezone } from "./common";

export const flaresolverrName = "flaresolverr";
export const flaresolverrPort = 8191;

const health = httpCheck("/health", flaresolverrPort);

// Unauthenticated and able to browse anywhere, so it has no route: only Prowlarr reaches it.
export const flaresolverrResources: ResourceLike[] = [
  buildDeployment(flaresolverrName, {
    securityContext: podSecurityContext,
    containers: [
      {
        name: "main",
        image: image("flaresolverr"),
        // Includes the memory-backed /dev/shm Chromium needs.
        resources: {
          requests: { cpu: "25m", memory: "128Mi" },
          limits: { memory: "1Gi" },
        },
        env: [
          { name: "TZ", value: timezone },
          { name: "LOG_LEVEL", value: "info" },
          // Chromium and undetected-chromedriver write their profile under HOME.
          { name: "HOME", value: "/tmp" },
        ],
        ports: [{ name: "http", containerPort: flaresolverrPort }],
        readinessProbe: readiness(health),
        startupProbe: startup(health, 120),
        securityContext: restrictedContainer(),
        volumeMounts: [
          { name: "tmp", mountPath: "/tmp" },
          { name: "shm", mountPath: "/dev/shm" },
        ],
      },
    ],
    volumes: [
      { name: "tmp", emptyDir: {} },
      // Chromium crashes on the 64Mi default /dev/shm.
      { name: "shm", emptyDir: { medium: "Memory", sizeLimit: "512Mi" } },
    ],
  }),
  buildService(flaresolverrName, [{ port: flaresolverrPort, name: "http" }]),
];
