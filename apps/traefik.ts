import { Project } from "../constants";
import type { StaticApp } from "../types";
import { readYaml } from "../utils";
import { certs } from "./traefik/certs";
import { externalAppResources } from "./traefik/externalApps";
import { externalGateway, internalGateway } from "./traefik/gateway";
import { httpRedirect } from "./traefik/redirect";
import { routes } from "./traefik/routes";

export const traefikNamespace = "traefik";

const config: StaticApp = {
  kind: "static",
  name: "traefik",
  project: Project.SYSTEM,
  // Remove once the chart has taken over from k3s's bundled Traefik; until then
  // a sync would start a second Traefik next to the live one.
  autoSync: false,
  helmReleases: [
    {
      chart: "traefik",
      releaseName: "traefik",
      values: await readYaml("./traefik/values.yaml", import.meta.url),
    },
  ],
  resources: [
    ...certs,
    internalGateway,
    externalGateway,
    httpRedirect,
    ...routes,
    ...externalAppResources,
  ],
};

export default config;
