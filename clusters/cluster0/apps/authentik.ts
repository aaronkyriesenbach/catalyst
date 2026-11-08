import { ReferenceGrant } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1beta1";
import {
  authentikHostOptions,
  authentikNamespace,
  authentikServiceName,
  authentikServicePort,
  oidcSecretName,
} from "@catalyst/platform/auth";
import { appUrl } from "@catalyst/platform/hostnames";
import { buildPostgresResources } from "@catalyst/platform/modifiers";
import type { AppConfig, ResourceLike, StaticApp } from "@catalyst/core/types";
import { appNamespace } from "@catalyst/core/apps";
import {
  awsRemoteKey,
  buildAwsExternalSecret,
  buildGeneratedSecret,
} from "@catalyst/k8s/secrets";
import { buildFileConfigMap } from "@catalyst/k8s/workload";
import { buildRoute } from "@catalyst/k8s/route";
import {
  httpTarget,
  routeTargets,
  serviceUrl,
  StatusGroup,
} from "@catalyst/platform/status";
import { mirrorRepository } from "@catalyst/versions/images";
import { readFile, readYaml } from "@catalyst/core/files";
import { buildWafMiddleware, resolveWaf } from "@catalyst/platform/waf";
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
    const namespace = appNamespace(config);
    const declared: DeclaredApp[] = [];

    if (config.oidc !== undefined) {
      declared.push({
        name: config.name,
        namespace,
        url: appUrl(config.name, {
          subDomain: config.subDomain,
          externallyAccessible:
            config.kind === "workload" ? config.externallyAccessible : false,
        }),
        oidc: config.oidc,
      });
    }

    for (const extra of config.additionalOidc ?? []) {
      declared.push({
        name: extra.name,
        namespace,
        url: appUrl(extra.name, {
          subDomain: extra.subDomain,
          externallyAccessible: extra.externallyAccessible,
        }),
        oidc: extra.oidc,
      });
    }

    return declared;
  });

  return apps.sort((a, b) => a.name.localeCompare(b.name));
}

const smtpSecret = awsRemoteKey(name, "smtp-credentials");

const recoveryFlow = await readFile(
  "./authentik/recovery-flow.yaml",
  import.meta.url,
);
const passkeyLogin = await readFile(
  "./authentik/passkey-login.yaml",
  import.meta.url,
);
const enrollmentFlow = await readFile(
  "./authentik/enrollment-flow.yaml",
  import.meta.url,
);
const baseValues = await readYaml("./authentik/values.yaml", import.meta.url);

const wafSetting = authentikHostOptions.externallyAccessible ? {} : undefined;
const resolvedWaf = resolveWaf(
  name,
  authentikHostOptions.externallyAccessible,
  wafSetting,
);

const config: StaticApp = {
  kind: "static",
  status: {
    targets: [
      httpTarget(
        "Authentik",
        StatusGroup.Platform,
        serviceUrl(
          authentikServiceName,
          authentikNamespace,
          authentikServicePort,
          "/-/health/live/",
        ),
      ),
      ...routeTargets("Authentik", "authentik", authentikHostOptions),
    ],
  },
  name,
  namespace: authentikNamespace,
  derive: ({ catalog }) => {
    const oidcApps = collectOidcApps(
      catalog.entries.map((entry) => entry.config),
    );
    const oauth2Apps = oidcApps.filter((app) => app.oidc.kind === "oauth2");
    const proxyNamespaces = [
      ...new Set(
        oidcApps
          .filter((app) => app.oidc.kind === "proxy")
          .map((app) => app.namespace),
      ),
    ].sort();

    const secrets: ResourceLike[] = [
      ...buildGeneratedSecret(
        name,
        `${name}-secret-key`,
        [{ key: "secret-key", length: 64, alphanumeric: true }],
        { persist: true },
      ),
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
      "recovery-flow.yaml": recoveryFlow,
      "passkey-login.yaml": passkeyLogin,
      "enrollment-flow.yaml": enrollmentFlow,
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
                to: [
                  { group: "", kind: "Service", name: authentikServiceName },
                ],
              },
            }),
          ]
        : [];

    return {
      resources: [
        ...buildPostgresResources(name, authentikNamespace, 17, {
          backup: true,
          resources: {
            requests: { cpu: "50m", memory: "128Mi" },
            limits: { memory: "768Mi" },
          },
        }),
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
  },
};

export default config;
