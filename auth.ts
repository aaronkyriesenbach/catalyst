import { Middleware } from "@kubernetes-models/traefik/traefik.io/v1alpha1/Middleware";
import { appHostname, appUrl, type HostOptions } from "./hostnames";

export const authentikNamespace = "authentik";
export const authentikServiceName = "authentik-server";
export const authentikServicePort = 80;

export const authentikHostOptions: HostOptions = {
  subDomain: "auth",
  externallyAccessible: true,
};

export const authentikHostname = appHostname("authentik", authentikHostOptions);
export const authentikUrl = appUrl("authentik", authentikHostOptions);

export const DEFAULT_CLIENT_SECRET_ROTATION = "2160h";

export const FORWARD_AUTH_MIDDLEWARE_NAME = "forward-auth";

export const OUTPOST_PATH_PREFIX = "/outpost.goauthentik.io/";

const FORWARD_AUTH_ADDRESS = `http://${authentikServiceName}.${authentikNamespace}.svc.cluster.local${OUTPOST_PATH_PREFIX}auth/traefik`;

const FORWARD_AUTH_RESPONSE_HEADERS = [
  "X-authentik-username",
  "X-authentik-groups",
  "X-authentik-entitlements",
  "X-authentik-email",
  "X-authentik-name",
  "X-authentik-uid",
  "X-authentik-jwt",
  "X-authentik-meta-jwks",
  "X-authentik-meta-outpost",
  "X-authentik-meta-provider",
  "X-authentik-meta-app",
  "X-authentik-meta-version",
];

// Identical for every app: authentik picks the provider from the forwarded host.
export function buildForwardAuthMiddleware(): Middleware {
  return new Middleware({
    metadata: { name: FORWARD_AUTH_MIDDLEWARE_NAME },
    spec: {
      forwardAuth: {
        address: FORWARD_AUTH_ADDRESS,
        trustForwardHeader: true,
        maxResponseBodySize: 4194304,
        authResponseHeaders: FORWARD_AUTH_RESPONSE_HEADERS,
      },
    },
  });
}

export function oidcIssuer(slug: string): string {
  return `${authentikUrl}/application/o/${slug}/`;
}

export function oidcDiscoveryUrl(slug: string): string {
  return `${oidcIssuer(slug)}.well-known/openid-configuration`;
}

// Shared by every provider, unlike the per-application issuer and discovery document.
export function oidcEndpointUrl(
  endpoint: "authorize" | "token" | "userinfo",
): string {
  return `${authentikUrl}/application/o/${endpoint}/`;
}

export function oidcSecretName(appName: string): string {
  return `oidc-${appName}`;
}

export function oidcCredentialsSecretName(appName: string): string {
  return `${appName}-oidc-credentials`;
}
