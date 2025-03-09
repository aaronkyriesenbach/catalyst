import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import ConfigPVC from "../shared/ConfigPVC.ts";
import { AppProps } from "../shared/AppProps.ts";
import { DEFAULT_LSCR_ENV, DEFAULT_NAS_VOLUME_NAME } from "../shared/constants.ts";
import { KubeNamespace } from "../shared/imports/k8s.ts";
import Deployment from "../shared/Deployment.ts";
import Service from "../shared/Service.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";

export class Transmission extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new KubeNamespace(this, "namespace", {
            metadata: {
                name: "transmission",
                labels: {
                    "pod-security.kubernetes.io/enforce": "privileged"
                }
            }
        });

        const configPVC = new ConfigPVC(this, "configpvc", { name: "config-pvc" });

        const gluetunRoleConfig = new GeneratedPassword(this, "gluetun-role-config", {
            name: "gluetun-role-config",
            secretTemplate: {
                type: "Opaque",
                stringData: {
                    "config.toml": Deno.readTextFileSync("gluetun-role-config.toml"),
                    key: "$(value)"
                }
            }
        });

        const transmissionApp: AppProps = {
            appName: "transmission",
            createNASVolume: true,
            volumes: [{
                name: configPVC.name,
                persistentVolumeClaim: {
                    claimName: configPVC.name
                }
            }, {
                name: gluetunRoleConfig.name,
                secret: {
                    secretName: gluetunRoleConfig.name
                }
            }],
            containers: [{
                name: "transmission",
                image: "lscr.io/linuxserver/transmission:4.0.6-r2-ls281",
                env: DEFAULT_LSCR_ENV,
                volumeMounts: [
                    {
                        name: DEFAULT_NAS_VOLUME_NAME,
                        mountPath: "/downloads",
                        subPath: "downloads"
                    },
                    {
                        name: DEFAULT_NAS_VOLUME_NAME,
                        mountPath: "/watch",
                        subPath: "downloads/watch"
                    },
                    {
                        name: configPVC.name,
                        mountPath: "/config"
                    }
                ]
            }],
            initContainers: [{
                name: "gluetun",
                image: "qmcgaw/gluetun:v3.40.0",
                restartPolicy: "Always",
                securityContext: {
                    capabilities: {
                        add: ["NET_ADMIN"]
                    }
                },
                ports: [{ name: "web", containerPort: 9091 }],
                env: [
                    {
                        name: "VPN_SERVICE_PROVIDER",
                        value: "protonvpn"
                    },
                    {
                        name: "VPN_TYPE",
                        value: "wireguard"
                    },
                    {
                        name: "SERVER_COUNTRIES",
                        value: "United States"
                    },
                    {
                        name: "PORT_FORWARD_ONLY",
                        value: "on"
                    },
                    {
                        name: "VPN_PORT_FORWARDING",
                        value: "on"
                    },
                    {
                        name: "WIREGUARD_PRIVATE_KEY",
                        valueFrom: {
                            secretKeyRef: {
                                name: "wireguard-private-key",
                                key: "key"
                            }
                        }
                    }
                ],
                volumeMounts: [
                    {
                        name: gluetunRoleConfig.name,
                        mountPath: "/gluetun/auth"
                    },
                    {
                        name: configPVC.name,
                        mountPath: "/gluetun"
                    }
                ]
            },
                {
                    name: "gluetrans",
                    image: "miklosbagi/gluetrans:v0.3.5",
                    restartPolicy: "Always",
                    env: [
                        {
                            name: "GLUETUN_CONTROL_ENDPOINT",
                            value: "http://localhost:8000"
                        },
                        {
                            name: "GLUETUN_CONTROL_API_KEY",
                            valueFrom: {
                                secretKeyRef: {
                                    name: gluetunRoleConfig.name,
                                    key: "key"
                                }
                            }
                        },
                        {
                            name: "GLUETUN_HEALTH_ENDPOINT",
                            value: "http://localhost:9999"
                        },
                        {
                            name: "TRANSMISSION_ENDPOINT",
                            value: "http://localhost:9091/transmission/rpc"
                        },
                        {
                            name: "TRANSMISSION_USER",
                            value: "transmission"
                        },
                        {
                            name: "TRANSMISSION_PASS",
                            value: "transmission"
                        }
                    ]
                }]
        };

        new Deployment(this, "deployment", transmissionApp);
        new Service(this, "service", transmissionApp);
        new IngressRoute(this, "ingress", { useInsecureTransport: true, ...transmissionApp });
    }
}

const app = new App();
new Transmission(app, "transmission");
app.synth();
