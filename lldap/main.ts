import { Construct } from "npm:constructs";
import { App, Chart, YamlOutputType } from "npm:cdk8s";

import Deployment from "../shared/Deployment.ts";
import { AppProps } from "../shared/AppProps.ts";
import Service from "../shared/Service.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { EnvVar } from "../shared/imports/k8s.ts";
import { LLDAPBootstrap } from "./bootstrap.ts";

export class LLDAP extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        // ENV_VAR_NAME: secret_spec
        const secrets = new Map(Object.entries({
            LLDAP_LDAP_USER_PASS: {
                name: "admin-pass",
                exportNamespaces: ["authelia"]
            },
            LLDAP_JWT_SECRET: { name: "jwt-secret" },
            LLDAP_KEY_SEED: { name: "key-seed" }
        }));

        const secretEnvVars: EnvVar[] = [];
        secrets.forEach((s, envVarName) => {
            new GeneratedPassword(this, s.name, {
                name: s.name,
                exportNamespaces: s.exportNamespaces
            });

            const v: EnvVar = {
                name: envVarName,
                valueFrom: { secretKeyRef: { name: s.name, key: "password" } }
            };

            secretEnvVars.push(v);
        });

        const appProps: AppProps = {
            appName: "lldap",
            containers: [{
                name: "lldap",
                image: "lldap/lldap:stable",
                ports: [
                    {
                        containerPort: 17170,
                        name: "web"
                    },
                    {
                        containerPort: 3890,
                        name: "ldap"
                    }
                ],
                env: [
                    {
                        name: "LLDAP_LDAP_BASE_DN",
                        value: "dc=lab53,dc=net"
                    },
                    ...secretEnvVars
                ]
            }]
        };

        new Deployment(this, "deployment", appProps);

        new Service(this, "service", appProps);

        new IngressRoute(this, "ingress", { useForwardAuth: false, ...appProps });
    }
}

const app = new App({ yamlOutputType: YamlOutputType.FILE_PER_APP }); // Required with multiple charts to properly cat out resources with separator
new LLDAP(app, "lldap");
new LLDAPBootstrap(app, "lldap-bootstrap");
app.synth();
