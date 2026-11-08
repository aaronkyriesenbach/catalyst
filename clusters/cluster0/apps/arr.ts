import { buildForwardAuthMiddleware } from "@catalyst/platform/auth";
import {
  httpTarget,
  routeTargets,
  serviceUrl,
  StatusGroup,
  tcpTarget,
  titleCase,
  type StatusTarget,
} from "@catalyst/platform/status";
import type {
  AdditionalOidcApp,
  ResourceLike,
  StaticApp,
} from "@catalyst/core/types";
import { buildRoute } from "@catalyst/k8s/route";
import { configarrResources } from "./arr/configarr";
import { arrNamespace, buildMediaVolume, mediaClaim } from "./arr/common";
import {
  flaresolverrName,
  flaresolverrPort,
  flaresolverrResources,
} from "./arr/flaresolverr";
import { sabnzbdName, sabnzbdPort, sabnzbdResources } from "./arr/sabnzbd";
import { buildServarr, type ServarrSpec } from "./arr/servarr";
import { torrentName, torrentPort, torrentResources } from "./arr/torrent";

const name = "arr";

type ServarrApp = Pick<ServarrSpec, "name" | "image" | "port" | "resources">;

const servarrDefinitions: ServarrApp[] = [
  {
    name: "radarr",
    image: "radarr",
    port: 7878,
    resources: {
      requests: { cpu: "25m", memory: "128Mi" },
      limits: { memory: "768Mi" },
    },
  },
  {
    name: "sonarr",
    image: "sonarr",
    port: 8989,
    resources: {
      requests: { cpu: "50m", memory: "256Mi" },
      limits: { memory: "1Gi" },
    },
  },
  {
    name: "lidarr",
    image: "lidarr",
    port: 8686,
    resources: {
      requests: { cpu: "50m", memory: "256Mi" },
      limits: { memory: "1Gi" },
    },
  },
  { name: "prowlarr", image: "prowlarr", port: 9696 },
];

const servarrApps: ServarrSpec[] = servarrDefinitions.map((app) => ({
  ...app,
  configStorage: "2Gi",
  mountsMedia: app.name !== "prowlarr",
  mediaClaim,
}));

// Every UI sits behind its own authentik forward-auth application; FlareSolverr has none.
const webApps = [
  ...servarrApps.map(({ name: app, port }) => ({ name: app, port })),
  { name: sabnzbdName, port: sabnzbdPort },
  { name: torrentName, port: torrentPort },
];

const additionalOidc: AdditionalOidcApp[] = webApps.map(({ name: app }) => ({
  name: app,
  oidc: { kind: "proxy" },
}));

const routes = webApps.map(({ name: app, port }) =>
  buildRoute(app, port, { authentikForwardAuth: true }),
);

const { pv: mediaPv, pvc: mediaPvc } = buildMediaVolume();

const titles: Record<string, string> = {
  [sabnzbdName]: "SABnzbd",
  [torrentName]: "qBittorrent",
};

const servarrNames = new Set(servarrApps.map((app) => app.name));

const statusTargets: StatusTarget[] = [
  ...webApps.flatMap(({ name: app, port }) => {
    const title = titles[app] ?? titleCase(app);
    const service = servarrNames.has(app)
      ? httpTarget(
          title,
          StatusGroup.Media,
          serviceUrl(app, arrNamespace, port, "/ping"),
        )
      : tcpTarget(title, StatusGroup.Media, `${app}.${arrNamespace}.svc`, port);

    return [service, ...routeTargets(title, app, {})];
  }),
  httpTarget(
    "FlareSolverr",
    StatusGroup.Media,
    serviceUrl(flaresolverrName, arrNamespace, flaresolverrPort, "/health"),
  ),
];

const resources: ResourceLike[] = [
  buildForwardAuthMiddleware(),
  mediaPv,
  mediaPvc,
  ...servarrApps.flatMap(buildServarr),
  ...sabnzbdResources,
  ...flaresolverrResources,
  ...torrentResources,
  ...configarrResources,
  ...routes,
];

const config: StaticApp = {
  kind: "static",
  name,
  namespace: arrNamespace,
  additionalOidc,
  status: { targets: statusTargets },
  resources,
};

export default config;
