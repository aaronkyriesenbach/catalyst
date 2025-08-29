import {
  IngressRoute as TraefikIngressRoute,
  IngressRouteSpecRoutesKind,
  IngressRouteSpecRoutesMiddlewares,
  IngressRouteSpecRoutesServicesPort,
} from "../imports/ingressroute-traefik.io.ts";
import { Construct } from "npm:constructs";

export default class IngressRoute extends TraefikIngressRoute {
  constructor(scope: Construct, props: IngressRouteProps) {
    const { name, service, ingressRouteSpec } = props;

    const {
      subdomain,
      customHostnamePrefix,
      matchOverride,
      useInsecureTransport = true,
      middlewares,
    } = ingressRouteSpec ?? {};

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        entryPoints: ["websecure"],
        routes: [
          {
            match:
              matchOverride ??
              `Host(\`${[customHostnamePrefix ?? name, subdomain, "lab53.net"]
                .filter(Boolean)
                .join(".")}\`)`,
            kind: IngressRouteSpecRoutesKind.RULE,
            middlewares: middlewares,
            services: [
              {
                name: service.name,
                serversTransport: useInsecureTransport
                  ? "traefik-insecuretransport@kubernetescrd"
                  : undefined,
                port: IngressRouteSpecRoutesServicesPort.fromNumber(
                  service.port,
                ),
              },
            ],
          },
        ],
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
  subdomain?: string;
  customHostnamePrefix?: string;
  matchOverride?: string;
  useInsecureTransport?: boolean;
  middlewares?: IngressRouteSpecRoutesMiddlewares[];
};
