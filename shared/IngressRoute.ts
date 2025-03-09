import { Construct } from "constructs";

import {
    IngressRoute as TraefikIngressRoute,
    IngressRouteSpecRoutesKind,
    IngressRouteSpecRoutesServicesPort
} from "./imports/traefik.io";


export default class IngressRoute extends Construct {
    constructor(scope: Construct, id: string, props: IngressRouteProps) {
        super(scope, id);

        const { serviceName, port, hostPrefix, useForwardAuth = true, useInsecureTransport = false } = props;

        new TraefikIngressRoute(this, id, {
            metadata: {
                name: `${ id }-ingress`
            },
            spec: {
                entryPoints: ["websecure"],
                routes: [{
                    match: `Host(\`${hostPrefix}.lab53.net\`)`,
                    kind: IngressRouteSpecRoutesKind.RULE,
                    middlewares: useForwardAuth ? [{ name: "forwardauth-authelia", namespace: "authelia" }] : undefined,
                    services: [{
                        name: serviceName,
                        serversTransport: useInsecureTransport ? "traefik-insecuretransport@kubernetescrd" : undefined,
                        port: IngressRouteSpecRoutesServicesPort.fromNumber(port)
                    }]
                }]
            }
        })
    }
}

type IngressRouteProps = {
    serviceName: string,
    port: number,
    hostPrefix: string,
    useForwardAuth?: boolean,
    useInsecureTransport?: boolean
};