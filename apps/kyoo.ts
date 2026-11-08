import { oidcEndpointUrl } from "../auth";
import { buildPostgresResources, defineOidcClient } from "../modifiers";
import {
  httpTarget,
  routeTargets,
  serviceUrl,
  StatusGroup,
  tcpTarget,
} from "../status";
import type { StaticApp } from "../types";
import { buildGeneratedSecret, mirrorRepository, readYaml } from "../utils";
import { middlewares, route } from "./kyoo/routes";

const name = "kyoo";
const apiKeysSecret = `${name}-apikeys`;

// Kyoo derives the callback from the provider's lowercased name in values.yaml.
const oidcClient = defineOidcClient(name, {
  redirectPaths: ["/auth/oidc/logged/authentik"],
});

const config: StaticApp = {
  kind: "static",
  name,
  oidc: oidcClient.oidc,
  status: {
    targets: [
      tcpTarget("Kyoo API", StatusGroup.Media, `${name}-api.${name}.svc`, 3567),
      httpTarget(
        "Kyoo",
        StatusGroup.Media,
        serviceUrl(`${name}-front`, name, 8901),
      ),
      ...routeTargets("Kyoo", name, {}),
    ],
  },
  resources: [
    ...buildPostgresResources(name, name, 17, { backup: true }),
    // Scanner and auth both read this key, so it has to survive a re-sync.
    ...buildGeneratedSecret(
      name,
      apiKeysSecret,
      [{ key: "scanner_apikey", length: 48, alphanumeric: true }],
      { persist: true },
    ),
    oidcClient.credentialsSecret,
    ...middlewares,
    route,
  ],
  helmReleases: [
    {
      chart: "kyoo",
      releaseName: name,
      values: await readYaml("./kyoo/values.yaml", import.meta.url),
      parameters: {
        "global.image.repositoryBase": mirrorRepository("ghcr.io/zoriya"),
        "kyoo.oidc_providers[0].authorizationAddress":
          oidcEndpointUrl("authorize"),
        "kyoo.oidc_providers[0].tokenAddress": oidcEndpointUrl("token"),
        "kyoo.oidc_providers[0].profileAddress": oidcEndpointUrl("userinfo"),
      },
    },
  ],
};

export default config;
