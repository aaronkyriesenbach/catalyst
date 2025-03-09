import { KubeConfigMap, KubePod, VolumeMount } from "../shared/imports/k8s.ts";
import { Password } from "../shared/imports/secretgen.k14s.io.ts";
import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { AppProps } from "../shared/AppProps.ts";
import { getPodSpec } from "../shared/Pod.ts";

export class LLDAPBootstrap extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const emptyConfigMap = new KubeConfigMap(
            this,
            "emptycm",
            {
                metadata: {
                    name: "empty-config"
                },
                data: {
                    "empty.json": "{}"
                }
            }
        );

        const emptyVolumeMounts = [
            "/bootstrap/group-configs",
            "/bootstrap/user-schemas",
            "/bootstrap/group-schemas"
        ].map((path): VolumeMount => ({
            name: emptyConfigMap.name,
            mountPath: path
        }));

        const userConfigSecret = new Password(this, "user-config", {
            metadata: {
                name: "user-config"
            },
            spec: {
                secretTemplate: {
                    type: "Opaque",
                    stringData: {
                        password: "$(value)",
                        "user.json": Deno.readTextFileSync("user.json")
                    }
                }
            }
        });

        const bootstrapAppProps: AppProps = {
            appName: "lldap-bootstrap",
            podRestartPolicy: "OnFailure",
            containers: [{
                name: "lldap-bootstrap",
                image: "lldap/lldap:stable",
                command: ["/app/bootstrap.sh"],
                env: [
                    {
                        name: "LLDAP_URL",
                        value: "http://lldap:17170"
                    },
                    {
                        name: "LLDAP_ADMIN_PASSWORD",
                        valueFrom: {
                            secretKeyRef: {
                                name: "admin-pass",
                                key: "password"
                            }
                        }
                    },
                    {
                        name: "DO_CLEANUP",
                        value: "true"
                    }
                ],
                volumeMounts: [{
                    name: userConfigSecret.name,
                    mountPath: "/bootstrap/user-configs"
                }, ...emptyVolumeMounts]
            }],
            volumes: [
                {
                    name: userConfigSecret.name,
                    secret: { secretName: userConfigSecret.name }
                },
                {
                    name: emptyConfigMap.name,
                    configMap: {
                        name: emptyConfigMap.name
                    }
                }
            ]
        };

        new KubePod(this, "bootstrap-pod", getPodSpec(bootstrapAppProps));
    }
}
