import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withNasMounts,
  withOidcAuth,
} from "../modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "jellyfin",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "jellyfin/jellyfin:10.11.8",
        ports: [{ name: "http", containerPort: 8096 }],
      },
    ],
  },
  webPort: 8096,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [
      { mountPath: "/config", subPath: "cluster/jellyfin/config" },
      { mountPath: "/cache", subPath: "cluster/jellyfin/cache" },
      { mountPath: "/movies", subPath: "movies" },
      { mountPath: "/tv", subPath: "tv" },
      { mountPath: "/live", subPath: "live" },
    ],
  }),
  withOidcAuth(),
);
