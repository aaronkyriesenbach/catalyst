import { Project } from "../constants";
import type { StaticApp } from "../types";
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
