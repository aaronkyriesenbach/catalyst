import { ReferenceGrant } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1beta1";
import {
  authentikHostOptions,
  authentikNamespace,
  authentikServiceName,
  authentikServicePort,
  oidcSecretName,
} from "../auth";
import { appUrl } from "../hostnames";
import { buildPostgresResources } from "../modifiers";
import type { AppConfig, ResourceLike, StaticApp } from "../types";
import {
  appNamespace,
  awsRemoteKey,
  buildAwsExternalSecret,
  buildFileConfigMap,
  buildGeneratedSecret,
  buildRoute,
  loadAllAppConfigs,
  mirrorRepository,
  readFile,
  readYaml,
} from "../utils";
import { buildWafMiddleware, resolveWaf } from "../waf";
import {
  buildAppsBlueprint,
  buildClientSecretBlueprint,
  type OidcApp,
} from "./authentik/blueprint";
import { groups, users } from "./authentik/users.config";

const name = "authentik";
const blueprintsConfigMap = `${name}-blueprints`;
const CLIENT_SECRET_BLUEPRINT_KEY = "client-secret.yaml";

type DeclaredApp = OidcApp & { namespace: string };

function collectOidcApps(configs: readonly AppConfig[]): DeclaredApp[] {
  const apps = configs.flatMap((config): DeclaredApp[] => {
    if (config.oidc === undefined) {
      return [];
    }

    return [
      {
        name: config.name,
        namespace: appNamespace(config),
        url: appUrl(config.name, config),
        oidc: config.oidc,
      },
    ];
  });

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

const oidcApps = collectOidcApps(await loadAllAppConfigs(`${name}.ts`));
const oauth2Apps = oidcApps.filter((app) => app.oidc.kind === "oauth2");
const proxyNamespaces = [
  ...new Set(
    oidcApps
      .filter((app) => app.oidc.kind === "proxy")
      .map((app) => app.namespace),
  ),
].sort();

const smtpSecret = awsRemoteKey(name, "smtp-credentials");

const secrets: ResourceLike[] = [
  ...buildGeneratedSecret(
    name,
    `${name}-secret-key`,
    [{ key: "secret-key", length: 64, alphanumeric: true }],
    { persist: true },
  ),
  // Only read on first start; the declared user is the day-to-day admin.
  ...buildGeneratedSecret(
    name,
    `${name}-bootstrap-password`,
    [{ key: "password", length: 32, alphanumeric: true }],
    { persist: true },
  ),
  buildAwsExternalSecret(
    `${name}-smtp`,
    ["host", "username", "password", "from"].map((property) => ({
      remoteKey: smtpSecret,
      property,
      secretKey: property,
    })),
  ),
  // Authentik owns client secrets: it seeds and rotates them, and apps read the same key.
  ...oauth2Apps.flatMap((app) =>
    app.oidc.kind === "oauth2"
      ? buildGeneratedSecret(
          name,
          oidcSecretName(app.name),
          [{ key: "client_secret", length: 48, alphanumeric: true }],
          {
            persist: true,
            rotate: app.oidc.rotate || undefined,
            template: {
              data: {
                [CLIENT_SECRET_BLUEPRINT_KEY]: buildClientSecretBlueprint(
                  app.name,
                ),
              },
            },
          },
        )
      : [],
  ),
];

const blueprints = buildFileConfigMap(blueprintsConfigMap, {
  "catalyst-apps.yaml": buildAppsBlueprint(oidcApps, users, groups),
  "recovery-flow.yaml": await readFile(
    "./authentik/recovery-flow.yaml",
    import.meta.url,
  ),
  "enrollment-flow.yaml": await readFile(
    "./authentik/enrollment-flow.yaml",
    import.meta.url,
  ),
});

const referenceGrant =
  proxyNamespaces.length > 0
    ? [
        new ReferenceGrant({
          metadata: { name: "forward-auth-routes" },
          spec: {
            from: proxyNamespaces.map((namespace) => ({
              group: "gateway.networking.k8s.io",
              kind: "HTTPRoute",
              namespace,
            })),
            to: [{ group: "", kind: "Service", name: authentikServiceName }],
          },
        }),
      ]
    : [];

const baseValues = await readYaml("./authentik/values.yaml", import.meta.url);

const wafSetting = authentikHostOptions.externallyAccessible ? {} : undefined;
const resolvedWaf = resolveWaf(
  name,
  authentikHostOptions.externallyAccessible,
  wafSetting,
);

const config: StaticApp = {
  kind: "static",
  name,
  namespace: authentikNamespace,
  resources: [
    ...buildPostgresResources(name, authentikNamespace, 17, { backup: true }),
    ...secrets,
    blueprints,
    ...referenceGrant,
    ...(resolvedWaf ? [buildWafMiddleware(resolvedWaf)] : []),
    buildRoute(name, authentikServicePort, {
      ...authentikHostOptions,
      serviceName: authentikServiceName,
      waf: wafSetting,
    }),
  ],
  helmReleases: [
    {
      chart: "authentik",
      releaseName: name,
      values: {
        ...baseValues,
        blueprints: {
          configMaps: [blueprintsConfigMap],
          secrets: oauth2Apps.map((app) => oidcSecretName(app.name)),
        },
      },
      parameters: {
        "global.image.repository": mirrorRepository(
          "ghcr.io/goauthentik/server",
        ),
      },
    },
  ],
};

export default config;
