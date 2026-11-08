import { Project } from "@catalyst/core/constants";
import type { StaticApp } from "@catalyst/core/types";
import { readYaml } from "@catalyst/core/files";
import { certs } from "./traefik/certs";
import { externalAppResources } from "./traefik/externalApps";
import { externalGateway, internalGateway } from "./traefik/gateway";
import { httpRedirect } from "./traefik/redirect";
import { routes } from "./traefik/routes";
import { traefikStatusTargets } from "./traefik/status";

export const traefikNamespace = "traefik";

const config: StaticApp = {
  kind: "static",
  name: "traefik",
  project: Project.SYSTEM,
  status: { targets: traefikStatusTargets },
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
