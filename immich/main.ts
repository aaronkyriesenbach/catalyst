import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Immich as ImmichChart } from "./imports/immich.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import CNPGCluster from "../shared/CNPGCluster.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import NASVolume from "../shared/NASVolume.ts";

export class Immich extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const postgresSecret = new GeneratedPassword(this, "postgres-creds", {
            name: "immich-user",
            secretTemplate: {
                stringData: {
                    username: "immich",
                    password: "$(value)"
                }
            }
        });

        new CNPGCluster(this, "cluster", {
            appName: "immich",
            imageName: "ghcr.io/tensorchord/cloudnative-pgvecto.rs:16-v0.3.0", // Immich requires pgvecto.rs < v0.4.0
            postgresql: {
                sharedPreloadLibraries: ["vectors.so"]
            },
            passwordSecret: {
                name: postgresSecret.name,
                key: "password"
            },
            superuser: true // Immich requires superuser access for database administration and automatic backups
        });

        const nasVolume = new NASVolume(this, "nasvolume", {
            size: "1Ti",
            customNASPath: "/mnt/tank/data/pictures"
        });

        const chart = new ImmichChart(this, "chart", {
            namespace: "immich",
            releaseName: "immich",
            values: {
                env: {
                    DB_HOSTNAME: "immich-cluster-rw",
                    DB_PASSWORD: {
                        valueFrom: {
                            secretKeyRef: {
                                name: postgresSecret.name,
                                key: "password"
                            }
                        }
                    }
                },
                immich: {
                    persistence: {
                        library: {
                            existingClaim: nasVolume.pvcName
                        }
                    }
                },
                image: {
                    tag: "v1.129.0"
                },
                redis: {
                    enabled: true
                }
            }
        });

        const serviceApiObject = chart.apiObjects.find(c => c.kind === "Service" && c.name.includes("-server"))

        new IngressRoute(this, "ingress", {
            appName: serviceApiObject.name,
            customHostPrefix: "immich",
            useInsecureTransport: true,
            useForwardAuth: false,
            customPort: 2283
        });
    }
}

const app = new App();
new Immich(app, "immich");
app.synth();
