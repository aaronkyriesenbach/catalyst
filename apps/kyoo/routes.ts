import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { Middleware } from "@kubernetes-models/traefik/traefik.io/v1alpha1/Middleware";
import { appHostname, extensionRefFilter } from "../../utils";

const namespace = "kyoo";

// Mirrors the routing file in the kyoo chart (templates/traefikproxy/configmap.yaml);
// re-check it when the chart version changes.
const services = {
  api: { name: `${namespace}-api`, port: 3567 },
  auth: { name: `${namespace}-auth`, port: 4568 },
  front: { name: `${namespace}-front`, port: 8901 },
  scanner: { name: `${namespace}-scanner`, port: 4389 },
  transcoder: { name: `${namespace}-transcoder`, port: 7666 },
};

const phantomToken = `${namespace}-phantom-token`;
const stripForwarded = `${namespace}-strip-forwarded`;
const cors = `${namespace}-cors`;

export const middlewares = [
  // Trades the user's session or the scanner's API key for the JWT the backends expect.
  new Middleware({
    metadata: { name: phantomToken },
    spec: {
      forwardAuth: {
        address: `http://${services.auth.name}.${namespace}.svc:${services.auth.port}/auth/jwt`,
        authRequestHeaders: [
          "Authorization",
          "X-Api-Key",
          "Cookie",
          "Sec-WebSocket-Protocol",
        ],
        authResponseHeaders: ["Authorization"],
      },
    },
  }),
  // Auth verifies presigned URLs against these, so only forwardAuth may set them.
  new Middleware({
    metadata: { name: stripForwarded },
    spec: {
      headers: {
        customRequestHeaders: {
          "X-Forwarded-Uri": "",
          "X-Forwarded-Method": "",
        },
      },
    },
  }),
  new Middleware({
    metadata: { name: cors },
    spec: {
      headers: {
        accessControlAllowOriginList: ["*"],
        accessControlAllowMethods: ["GET", "OPTIONS"],
        accessControlAllowHeaders: [
          "Authorization",
          "Content-Type",
          "Range",
          "X-Api-Key",
        ],
        addVaryHeader: true,
      },
    },
  }),
];

type Backend = { name: string; port: number };

function rule(path: string, backend: Backend, filters: string[] = []) {
  return {
    matches: [{ path: { type: "PathPrefix" as const, value: path } }],
    filters: filters.length > 0 ? filters.map(extensionRefFilter) : undefined,
    backendRefs: [backend],
  };
}

export const route = new HTTPRoute({
  metadata: { name: namespace },
  spec: {
    parentRefs: [{ name: "traefik-internal", namespace: "traefik" }],
    hostnames: [appHostname(namespace)],
    rules: [
      rule("/video", services.transcoder, [cors, phantomToken]),
      rule("/api", services.api, [cors, phantomToken]),
      rule("/swagger", services.api),
      rule("/scanner", services.scanner, [phantomToken]),
      rule("/auth", services.auth, [stripForwarded]),
      rule("/.well-known", services.auth),
      rule("/", services.front),
    ],
  },
});
