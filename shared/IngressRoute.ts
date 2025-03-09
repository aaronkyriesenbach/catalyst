import {
    IngressRoute as TraefikIngressRoute,
    IngressRouteSpecRoutesKind,
    IngressRouteSpecRoutesServicesPort
} from "./imports/traefik.io";
import { Construct } from "constructs";
import { getPorts } from "./Service";
import { AppProps } from "./AppProps";

export default class IngressRoute extends TraefikIngressRoute {
    constructor(scope: Construct, id: string, props: IngressRouteProps) {
        const {
            appName,
            containers,
            customHostPrefix,
            useForwardAuth = true,
            useInsecureTransport,
            customPort
        } = props;

        const ports = getPorts(containers);

        super(scope, id, {
            metadata: { name: appName }, spec: {
                entryPoints: ["websecure"],
                routes: [{
                    match: `Host(\`${ customHostPrefix ?? appName }.lab53.net\`)`,
                    kind: IngressRouteSpecRoutesKind.RULE,
                    middlewares: useForwardAuth ? [{ name: "forwardauth-authelia", namespace: "authelia" }] : undefined,
                    services: [{
                        name: appName,
                        serversTransport: useInsecureTransport ? "traefik-insecuretransport@kubernetescrd" : undefined,
                        port: IngressRouteSpecRoutesServicesPort.fromNumber(customPort ?? ports[0].port)
                    }]
                }],
                tls: {
                    certResolver: "letsencrypt"
                }
            }
        })
    }
}

export type IngressRouteProps = AppProps & {
    customPort?: number,
    customHostPrefix?: string,
    useForwardAuth?: boolean,
    useInsecureTransport?: boolean
};