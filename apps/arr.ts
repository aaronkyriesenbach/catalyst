import { buildForwardAuthMiddleware } from "../auth";
import type { AdditionalOidcApp, ResourceLike, StaticApp } from "../types";
import { buildRoute } from "../utils";
import { configarrResources } from "./arr/configarr";
import { arrNamespace, buildMediaVolume, mediaClaim } from "./arr/common";
import { flaresolverrResources } from "./arr/flaresolverr";
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
  resources,
};

export default config;
