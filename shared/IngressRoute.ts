import {
    IngressRoute as TraefikIngressRoute,
    IngressRouteSpecRoutesKind,
    IngressRouteSpecRoutesMiddlewares,
    IngressRouteSpecRoutesServicesPort
} from "./imports/traefik.io.ts";
import { Construct } from "npm:constructs";
import { ApiObjectProps } from "npm:cdk8s";
import { getPorts } from "./Service.ts";
import { AppProps } from "./AppProps.ts";

export default class IngressRoute extends TraefikIngressRoute {
    constructor(scope: Construct, id: string, props: IngressRouteProps) {
        const {
            appName,
            namespace,
            containers = [],
            initContainers = [],
            customHostPrefix,
            useForwardAuth = true,
            useInsecureTransport,
            customPort,
            middlewares
        } = props;

        const ports = getPorts([...containers, ...initContainers]);
        const createMiddlewares = useForwardAuth
            ? [{
                name: "forwardauth-authelia",
                namespace: "authelia"
            }, ...(middlewares ?? [])]
            : middlewares;

        super(scope, id, {
            metadata: {
                name: `${ appName ?? id }${ customHostPrefix ? `-${ customHostPrefix }` : "" }`,
                namespace: namespace
            },
            spec: {
                entryPoints: ["websecure"],
                routes: [{
                    match: `Host(\`${ customHostPrefix ?? appName }.lab53.net\`)`,
                    kind: IngressRouteSpecRoutesKind.RULE,
                    middlewares: createMiddlewares,
                    services: [{
                        name: appName,
                        serversTransport: useInsecureTransport
                            ? "traefik-insecuretransport@kubernetescrd"
                            : undefined,
                        port: IngressRouteSpecRoutesServicesPort.fromNumber(
                            customPort ?? ports[0].port
                        )
                    }]
                }],
                tls: {
                    certResolver: "letsencrypt"
                }
            }
        });
    }
}

export type IngressRouteProps = AppProps & ApiObjectProps & {
    customPort?: number;
    customHostPrefix?: string;
    useForwardAuth?: boolean;
    useInsecureTransport?: boolean;
    middlewares?: IngressRouteSpecRoutesMiddlewares[];
};
