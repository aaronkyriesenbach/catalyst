import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { AppProps } from "../shared/AppProps.ts";
import Deployment from "../shared/Deployment.ts";
import { KubeConfigMap } from "../shared/imports/k8s.ts";
import Service from "../shared/Service.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class TraefikExternal extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const traefikConfigMap = new KubeConfigMap(this, "traefik-config-cm", {
            metadata: {
                name: "traefik-external-config"
            },
            data: {
                "traefik.yaml": Deno.readTextFileSync("traefik.yaml"),
                "dynamic.yaml": Deno.readTextFileSync("dynamic.yaml")
            }
        });

        const traefikExternalApp: AppProps = {
            appName: "traefik-external",
            volumes: [{
                name: traefikConfigMap.name,
                configMap: {
                    name: traefikConfigMap.name
                }
            }],
            containers: [{
                name: "traefik-external",
                image: "traefik:v3.3",
                ports: [{ containerPort: 80, name: "web" }, {
                    containerPort: 443,
                    name: "websecure"
                }],
                volumeMounts: [{
                    mountPath: "/etc/traefik",
                    name: traefikConfigMap.name
                }]
            }]
        };

        new Deployment(this, "deployment", traefikExternalApp);
        new Service(this, "service", traefikExternalApp);

        new IngressRoute(this, "pve-ingressroute", {
            ...traefikExternalApp,
            customHostPrefix: "pve",
            useForwardAuth: false,
            useInsecureTransport: true
        });

        new IngressRoute(this, "truenas-ingressroute", {
            ...traefikExternalApp,
            customHostPrefix: "truenas",
            useForwardAuth: false,
            useInsecureTransport: true
        });
    }
}

const app = new App();
new TraefikExternal(app, "traefik-external");
app.synth();
