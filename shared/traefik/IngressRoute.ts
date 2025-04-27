import {
  IngressRoute as TraefikIngressRoute,
  IngressRouteSpecRoutesKind,
  IngressRouteSpecRoutesMiddlewares,
  IngressRouteSpecRoutesServicesPort
} from "../imports/ingressroute-traefik.io.ts";
import { Construct } from "npm:constructs";

export default class IngressRoute extends TraefikIngressRoute {
  constructor(scope: Construct, props: IngressRouteProps) {
    const {
      name,
      service,
      ingressRouteSpec,
    } = props;

    const {
      customHostPrefix,
      matchOverride,
      useForwardAuth = true,
      useInsecureTransport = false,
      middlewares,
    } = ingressRouteSpec ?? {};

    const createMiddlewares = useForwardAuth
      ? [{
        name: "forwardauth-authelia",
        namespace: "authelia",
      }, ...(middlewares ?? [])]
      : middlewares;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        entryPoints: ["websecure"],
        routes: [{
          match: matchOverride ??
            `Host(\`${customHostPrefix ?? name}.lab53.net\`)`,
          kind: IngressRouteSpecRoutesKind.RULE,
          middlewares: createMiddlewares,
          services: [{
            name: service.name,
            serversTransport: useInsecureTransport
              ? "traefik-insecuretransport@kubernetescrd"
              : undefined,
            port: IngressRouteSpecRoutesServicesPort.fromNumber(service.port),
          }],
        }]
      },
    });
  }
}

export type IngressRouteProps = {
  name: string;
  service: {
    name: string;
    port: number;
  };
  ingressRouteSpec?: IngressRouteSpec;
};

export type IngressRouteSpec = {
  customHostPrefix?: string;
  matchOverride?: string;
  useForwardAuth?: boolean;
  useInsecureTransport?: boolean;
  middlewares?: IngressRouteSpecRoutesMiddlewares[];
};
