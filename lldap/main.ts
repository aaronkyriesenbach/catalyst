import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { EnvVar } from "../shared/imports/k8s.ts";
import { LLDAPBootstrap } from "./bootstrap.ts";
import { Lab53App } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";

export class LLDAP extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    // ENV_VAR_NAME: secret_spec
    const secrets = new Map(Object.entries({
      LLDAP_LDAP_USER_PASS: {
        name: "admin-pass",
        exportNamespaces: ["authelia"],
      },
      LLDAP_JWT_SECRET: { name: "jwt-secret" },
      LLDAP_KEY_SEED: { name: "key-seed" },
    }));

    const secretEnvVars: EnvVar[] = [];
    secrets.forEach((s, envVarName) => {
      new GeneratedPassword(this, {
        name: s.name,
        exportNamespaces: s.exportNamespaces,
      });

      const v: EnvVar = {
        name: envVarName,
        valueFrom: { secretKeyRef: { name: s.name, key: "password" } },
      };

      secretEnvVars.push(v);
    });

    new Application(this, {
      name: "lldap",
      podSpecProps: {
        containers: [{
          name: "lldap",
          image: "lldap/lldap:stable",
          ports: [
            {
              containerPort: 17170,
              name: "web",
            },
            {
              containerPort: 3890,
              name: "ldap",
            },
          ],
          env: [
            {
              name: "LLDAP_LDAP_BASE_DN",
              value: "dc=lab53,dc=net",
            },
            ...secretEnvVars,
          ],
        }],
      },
      ingressRouteSpec: {
        useForwardAuth: false,
      },
      webPort: 17170,
    });
  }
}

const app = new Lab53App();
new LLDAP(app, "lldap");
new LLDAPBootstrap(app, "lldap-bootstrap");
app.synth();
