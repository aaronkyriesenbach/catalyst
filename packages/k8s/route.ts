import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import {
  authentikNamespace,
  authentikServiceName,
  authentikServicePort,
  FORWARD_AUTH_MIDDLEWARE_NAME,
  OUTPOST_PATH_PREFIX,
} from "@catalyst/platform/auth";
import { appHostname } from "@catalyst/platform/hostnames";
import {
  resolveWaf,
  WAF_MIDDLEWARE_NAME,
  type WafSetting,
} from "@catalyst/platform/waf";

type RouteOptions = {
  subDomain?: string;
  serviceName?: string;
  namespace?: string;
  externallyAccessible?: boolean;
  /** Forward auth through the authentik outpost; the `forward-auth` Middleware must exist in the route's namespace. */
  authentikForwardAuth?: boolean;
  /** Required for externally accessible routes. The `crowdsec-appsec` Middleware must exist in the route's namespace unless exempt. */
  waf?: WafSetting;
};

export function extensionRefFilter(middlewareName: string) {
  return {
    type: "ExtensionRef" as const,
    extensionRef: {
      group: "traefik.io",
      kind: "Middleware",
      name: middlewareName,
    },
  };
}

export function buildRoute(
  name: string,
  port: number,
  options?: RouteOptions,
): HTTPRoute {
  const {
    subDomain,
    serviceName,
    namespace,
    externallyAccessible,
    authentikForwardAuth,
    waf,
  } = options ?? {};

  if (externallyAccessible && waf === undefined) {
    throw new Error(
      `Route '${name}' is externally accessible: pass waf options or an exemption reason`,
    );
  }

  const wafEnabled = resolveWaf(name, externallyAccessible, waf) !== undefined;
  const hostname = appHostname(name, { subDomain, externallyAccessible });

  const parentRefs = externallyAccessible
    ? [
        { name: "traefik-external", namespace: "traefik" },
        { name: "traefik-internal", namespace: "traefik" },
      ]
    : [{ name: "traefik-internal", namespace: "traefik" }];

  // WAF first so attacks are rejected before the OIDC redirect.
  const wafFilters = wafEnabled
    ? [extensionRefFilter(WAF_MIDDLEWARE_NAME)]
    : [];
  const filters = [
    ...wafFilters,
    ...(authentikForwardAuth
      ? [extensionRefFilter(FORWARD_AUTH_MIDDLEWARE_NAME)]
      : []),
  ];

  // Login redirects and callbacks land on the app's own host, so the outpost must be routable there.
  const outpostRule = authentikForwardAuth
    ? [
        {
          matches: [
            {
              path: { type: "PathPrefix" as const, value: OUTPOST_PATH_PREFIX },
            },
          ],
          filters: wafFilters.length > 0 ? wafFilters : undefined,
          backendRefs: [
            {
              name: authentikServiceName,
              namespace: authentikNamespace,
              port: authentikServicePort,
            },
          ],
        },
      ]
    : [];

  return new HTTPRoute({
    metadata: {
      name,
      namespace,
    },
    spec: {
      parentRefs,
      hostnames: [hostname],
      rules: [
        ...outpostRule,
        {
          filters: filters.length > 0 ? filters : undefined,
          backendRefs: [
            {
              name: serviceName ?? name,
              port,
              namespace,
            },
          ],
        },
      ],
    },
  });
}
