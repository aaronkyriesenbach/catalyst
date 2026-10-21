import {
  authentikUrl,
  DEFAULT_CLIENT_SECRET_ROTATION,
  oidcCredentialsSecretName,
} from "../auth";
import { Project } from "../constants";
import { appUrl } from "../hostnames";
import { buildOidcCredentialsSecret } from "../modifiers";
import type { StaticApp } from "../types";
import { buildRoute, mergeValues, mirrorRepository, readYaml } from "../utils";
import { alertmanagerConfig } from "./victoria-metrics/alertmanager";
import {
  grafanaServiceName,
  monitoringNamespace,
} from "./victoria-metrics/endpoints";

const name = "victoria-metrics";
const grafanaSubDomain = "grafana";
const oidcCredentials = oidcCredentialsSecretName(name);

const oauthEndpoint = (path: string) => `${authentikUrl}/application/o/${path}`;

const fromOidcSecret = (key: string) => ({
  secretKeyRef: { name: oidcCredentials, key },
});

type UpstreamImage = Parameters<typeof mirrorRepository>[0];

function mirroredImage(
  path: string,
  upstream: UpstreamImage,
): Record<string, string> {
  const [registry, ...repository] = mirrorRepository(upstream).split("/");

  return {
    [`${path}.registry`]: registry ?? "",
    [`${path}.repository`]: repository.join("/"),
  };
}

const values = mergeValues(
  await readYaml("./victoria-metrics/values.yaml", import.meta.url),
  {
    alertmanager: { config: alertmanagerConfig },
    grafana: {
      envValueFrom: {
        GF_AUTH_GENERIC_OAUTH_CLIENT_ID: fromOidcSecret("client_id"),
        GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET: fromOidcSecret("client_secret"),
      },
      "grafana.ini": {
        server: {
          root_url: appUrl(name, { subDomain: grafanaSubDomain }),
        },
        "auth.generic_oauth": {
          enabled: true,
          name: "authentik",
          allow_sign_up: true,
          scopes: "openid profile email",
          auth_url: oauthEndpoint("authorize/"),
          token_url: oauthEndpoint("token/"),
          api_url: oauthEndpoint("userinfo/"),
          signout_redirect_url: oauthEndpoint(`${name}/end-session/`),
          use_pkce: true,
          role_attribute_path:
            "contains(groups[*], 'admin') && 'GrafanaAdmin' || 'Viewer'",
          allow_assign_grafana_admin: true,
        },
      },
    },
  },
);

const config: StaticApp = {
  kind: "static",
  name,
  namespace: monitoringNamespace,
  project: Project.SYSTEM,
  subDomain: grafanaSubDomain,
  oidc: {
    kind: "oauth2",
    redirectPaths: ["/login/generic_oauth"],
    rotate: DEFAULT_CLIENT_SECRET_ROTATION,
  },
  resources: [
    buildOidcCredentialsSecret(name, true),
    buildRoute(grafanaSubDomain, 80, {
      serviceName: grafanaServiceName,
      namespace: monitoringNamespace,
    }),
  ],
  helmReleases: [
    {
      chart: "victoriaMetricsK8sStack",
      releaseName: "vm",
      values,
      // The custom resources only carry `image.tag`, so the operator would pull from upstream.
      parameters: {
        "victoria-metrics-operator.image.repository": mirrorRepository(
          "docker.io/victoriametrics/operator",
        ),
        "vmsingle.spec.image.repository": mirrorRepository(
          "docker.io/victoriametrics/victoria-metrics",
        ),
        "vlsingle.spec.image.repository": mirrorRepository(
          "docker.io/victoriametrics/victoria-logs",
        ),
        "vtsingle.spec.image.repository": mirrorRepository(
          "docker.io/victoriametrics/victoria-traces",
        ),
        "vmalert.spec.image.repository": mirrorRepository(
          "docker.io/victoriametrics/vmalert",
        ),
        "alertmanager.spec.image.repository": mirrorRepository(
          "docker.io/prom/alertmanager",
        ),
        "syncJob.image.repository": mirrorRepository(
          "ghcr.io/victoriametrics/sync-job",
        ),
        ...mirroredImage(
          "kube-state-metrics.image",
          "registry.k8s.io/kube-state-metrics/kube-state-metrics",
        ),
        ...mirroredImage(
          "prometheus-node-exporter.image",
          "quay.io/prometheus/node-exporter",
        ),
        ...mirroredImage("grafana.image", "docker.io/grafana/grafana"),
        ...mirroredImage(
          "grafana.sidecar.image",
          "quay.io/kiwigrid/k8s-sidecar",
        ),
      },
    },
  ],
};

export default config;
