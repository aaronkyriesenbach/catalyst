import { Chart, ChartProps } from "cdk8s";
import { Construct } from "constructs";

import {
    IngressRoute as TraefikIngressRoute,
    IngressRouteSpecRoutesKind,
    IngressRouteSpecRoutesServicesPort
} from "./imports/traefik.io";


export default class IngressRoute extends Chart {
    constructor(scope: Construct, id: string, props: IngressRouteProps) {
        super(scope, id, props);

        const { serviceName, port, useForwardAuth = true, useInsecureTransport = false, customHostPrefix } = props;

        new TraefikIngressRoute(this, id, {
            metadata: {
                name: `${ id }-ingress`
            },
            spec: {
                entryPoints: ["websecure"],
                routes: [{
                    match: `Host(\`${ customHostPrefix ?? id }.lab53.net\`)`,
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

type IngressRouteProps = ChartProps & {
    serviceName: string,
    port: number,
    useForwardAuth?: boolean,
    useInsecureTransport?: boolean,
    customHostPrefix?: string
};