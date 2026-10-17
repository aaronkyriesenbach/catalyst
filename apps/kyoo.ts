import {
  buildOidcClient,
  buildOidcGroup,
  buildPostgresResources,
} from "../modifiers";
import type { StaticApp } from "../types";
import { buildGeneratedSecret, readYaml } from "../utils";
import { middlewares, route } from "./kyoo/routes";

const name = "kyoo";
const hostOptions = { externallyAccessible: false };
const apiKeysSecret = `${name}-apikeys`;

const oidcApp = { name, webPort: 80, ...hostOptions };

const config: StaticApp = {
  kind: "static",
  name,
  resources: [
    ...buildPostgresResources(name, name, 17, { backup: true }),
    // Scanner and auth both read this key, so it has to survive a re-sync.
    ...buildGeneratedSecret(
      name,
      apiKeysSecret,
      [{ key: "scanner_apikey", length: 48, alphanumeric: true }],
      { persist: true },
    ),
    buildOidcGroup(oidcApp),
    buildOidcClient(oidcApp),
    ...middlewares,
    route,
  ],
  helmReleases: [
    {
      chart: "kyoo",
      releaseName: name,
      values: await readYaml("./kyoo/values.yaml", import.meta.url),
    },
  ],
};

export default config;
