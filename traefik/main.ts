import { Construct } from "constructs";
import { App, Chart } from "cdk8s";
import { Traefik as TraefikChart } from "./imports/traefik.ts";
import { ServersTransport } from "./imports/traefik.io.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class Traefik extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new ServersTransport(this, "insecuretransport", {
            metadata: {
                name: "insecuretransport"
            },
            spec: {
                insecureSkipVerify: true
            }
        });

        new IngressRoute(this, "argo-ingress", {
            appName: "argocd-server",
            namespace: "argocd",
            customHostPrefix: "argo",
            useForwardAuth: false,
            useInsecureTransport: true,
            customPort: 443
        });

        new TraefikChart(this, "traefik", {
            namespace: "traefik",
            releaseName: "traefik",
            values: {
                deployment: {
                    revisionHistoryLimit: 1
                },
                certificatesResolvers: {
                    additionalValues: {
                        letsencrypt: {
                            acme: {
                                tlsChallenge: true,
                                httpChallenge: {
                                    entryPoint: "web"
                                },
                                storage: "/data/acme.json",
                                email: "aaron@kyriesenba.ch"
                            }
                        }
                    }
                },
                persistence: {
                    enabled: true
                },
                providers: {
                    additionalValues: {
                        kubernetesCRD: {
                            allowCrossNamespace: true
                        }
                    }
                },
                ingressRoute: {
                    dashboard: {
                        enabled: true,
                        matchRule: "Host(`traefik.lab53.net`)",
                        entryPoints: ["websecure"],
                        middlewares: [{
                            name: "forwardauth-authelia",
                            namespace: "authelia"
                        }],
                        tls: {
                            additionalValues: {
                                certResolver: "letsencrypt"
                            }
                        }
                    }
                }
            }
        });
    }
}

const app = new App();
new Traefik(app, "traefik");
app.synth();
