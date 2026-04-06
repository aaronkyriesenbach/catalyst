import { AppConfig } from "../types";
import { certs } from "./traefik/certs";
import { httpRedirect } from "./traefik/redirect";
import { gateway } from "./traefik/gateway";
import { routes } from "./traefik/routes";
import { insecureTransport } from "./traefik/transports";

const config: AppConfig = {
  name: "traefik",
  extraResources: [
    ...certs,
    gateway,
    httpRedirect,
    insecureTransport,
    ...routes,
  ],
};

export default config;
