import type { ImageRegistry } from "@catalyst/versions/versions";

export const site = {
  domain: "lab53.net",
  lanCidr: "192.168.0.0/16",
  nas: { ip: "192.168.53.120", path: "/mnt/tank/data" },
  mirror: {
    host: "zot.int.lab53.net",
    prefixes: {
      "docker.io": "docker",
      "ghcr.io": "ghcr",
      "quay.io": "quay",
      "registry.k8s.io": "k8s",
      "docker.dragonflydb.io": "dragonfly",
    } satisfies Record<ImageRegistry, string>,
  },
  cloudflareZoneId: "6383809236b97157242971dbb4160888",
  defaultContainerResources: {
    requests: { cpu: "10m", memory: "64Mi" },
    limits: { cpu: "1", memory: "512Mi" },
  },
} as const;
