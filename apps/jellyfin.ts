import {
  applyModifiers,
  withIscsiVolumes,
  withNasMounts,
  withOidcClient,
} from "../modifiers";
import { httpCheck, readiness, startup } from "../probes";
import type { WorkloadApp } from "../types";
import { image } from "../utils";
import { jellyfinName, jellyfinPort } from "./jellyfin/common";
import { jellarrResources } from "./jellyfin/jellarr";

const base: WorkloadApp = {
  kind: "workload",
  name: jellyfinName,
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("jellyfin"),
        resources: {
          requests: { cpu: "100m", memory: "512Mi" },
          limits: { cpu: "4", memory: "3Gi" },
        },
        ports: [{ name: "http", containerPort: jellyfinPort }],
        readinessProbe: readiness(httpCheck("/health", jellyfinPort)),
        startupProbe: startup(httpCheck("/health", jellyfinPort), 300),
      },
    ],
  },
  webPort: jellyfinPort,
  extraResources: jellarrResources,
  progressDeadlineSeconds: 600,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      {
        name: "config",
        mountPath: "/config",
        storageRequest: "10Gi",
        backup: true,
      },
      { name: "cache", mountPath: "/cache", storageRequest: "50Gi" },
    ],
  }),
  withNasMounts({
    main: [
      { mountPath: "/movies", subPath: "media/movies" },
      { mountPath: "/tv", subPath: "media/tv" },
      { mountPath: "/live", subPath: "media/live" },
    ],
  }),
  withOidcClient({
    redirectPaths: ["/sso/OID/redirect/authentik"],
    rotate: false,
  }),
);
