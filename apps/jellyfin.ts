import { applyModifiers, withIscsiVolumes, withNasMounts, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "jellyfin",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "docker.int.lab53.net/jellyfin/jellyfin:10.11.10",
        ports: [{ name: "http", containerPort: 8096 }],
      },
    ],
  },
  webPort: 8096,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      { name: "config", mountPath: "/config", storage: "5Gi" },
      { name: "cache", mountPath: "/cache", storage: "20Gi" },
    ],
  }),
  withNasMounts({
    main: [
      { mountPath: "/movies", subPath: "movies" },
      { mountPath: "/tv", subPath: "tv" },
      { mountPath: "/live", subPath: "live" },
    ],
  }),
  withOidcAuth(),
);
