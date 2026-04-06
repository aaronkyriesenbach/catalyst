import { AppConfig } from "../types";
import { certs } from "./traefik/certs";
import { httpRedirect } from "./traefik/redirect";
import { gateway } from "./traefik/gateway";
import { routes } from "./traefik/routes";
import { externalAppResources } from "./traefik/externalApps";

const config: AppConfig = {
  name: "traefik",
  extraResources: [
    ...certs,
    gateway,
    httpRedirect,
    ...routes,
    ...externalAppResources,
  ],
};

export default config;
