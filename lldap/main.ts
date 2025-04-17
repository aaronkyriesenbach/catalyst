import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { EnvVar, VolumeMount } from "../shared/imports/k8s.ts";
import { Lab53App, readTextFileSync } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";
import ConfigMap from "../shared/ConfigMap.ts";

export class LLDAP extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const emptyConfigMap = new ConfigMap(
      this,
      {
        name: "empty-config",
        data: {
          "empty.json": "{}",
        },
      },
    );

    const emptyVolumeMounts = [
      "/bootstrap/group-configs",
      "/bootstrap/user-schemas",
      "/bootstrap/group-schemas",
    ].map((path): VolumeMount => ({
      name: emptyConfigMap.name,
      mountPath: path,
    }));

    const aaronUserConfig = new GeneratedPassword(this, {
      name: "aaron-user-config",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          password: "$(value)",
          "aaron-user.json": readTextFileSync("aaron-user.json"),
        },
      },
    });

    const carpalUserConfig = new GeneratedPassword(this, {
      name: "carpal-user-config",
      exportNamespaces: ["carpal"],
      secretTemplate: {
        type: "Opaque",
        stringData: {
          password: "$(value)",
          "carpal-user.json": readTextFileSync("carpal-user.json"),
          "config.yml": readTextFileSync("../carpal/config.yaml"),
        },
      },
    });

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
        }, {
          name: "lldap-bootstrap",
          image: "lldap/lldap:stable",
          command: [
            "/bin/bash",
            "-c",
            "/app/bootstrap.sh && echo 'Bootstrap complete, sleeping' && while true; do sleep 1000; done",
          ],
          env: [
            {
              name: "LLDAP_URL",
              value: "http://lldap:17170",
            },
            {
              name: "LLDAP_ADMIN_PASSWORD",
              valueFrom: {
                secretKeyRef: {
                  name: "admin-pass",
                  key: "password",
                },
              },
            },
            {
              name: "DO_CLEANUP",
              value: "true",
            },
          ],
          volumeMounts: [{
            name: aaronUserConfig.name,
            mountPath: "/bootstrap/user-configs/aaron-user.json",
            subPath: "aaron-user.json",
          }, {
            name: carpalUserConfig.name,
            mountPath: "/bootstrap/user-configs/carpal-user.json",
            subPath: "carpal-user.json",
          }, ...emptyVolumeMounts],
        }],
        volumes: [{
          name: aaronUserConfig.name,
          secret: { secretName: aaronUserConfig.name },
        }, {
          name: carpalUserConfig.name,
          secret: { secretName: carpalUserConfig.name },
        }, {
          name: emptyConfigMap.name,
          configMap: {
            name: emptyConfigMap.name,
          },
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
app.synth();
