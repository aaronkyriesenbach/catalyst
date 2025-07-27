import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import GeneratedSecret from "../../shared/mittwald-secret-gen/GeneratedSecret.ts";
import GeneratedPassword from "../../shared/secretgen/GeneratedPassword.ts";

class Kimai extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const adminPass = new GeneratedSecret(this, {
      name: "kimai-admin-pass",
      fieldsToGenerate: ["password"],
    });

    const kimaiDBPass = new GeneratedPassword(this, {
      name: "kimai-db-pass",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          secret: "$(value)",
          connectionString:
            "mysql://kimai:$(value)@mariadb:3306/kimai?charset=utf8mb4",
        },
      },
    });

    const appSecret = new GeneratedSecret(this, {
      name: "kimai-app-secret",
      fieldsToGenerate: ["secret"],
    });

    new Application(this, {
      name: "mariadb",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "hub.int.lab53.net/library/mariadb:11",
          ports: [{ containerPort: 3306 }],
          env: [{
            name: "MARIADB_USER",
            value: "kimai",
          }, {
            name: "MARIADB_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: kimaiDBPass.name,
                key: "secret",
              },
            },
          }, {
            name: "MARIADB_DATABASE",
            value: "kimai",
          }, {
            name: "MARIADB_RANDOM_ROOT_PASSWORD",
            value: "true",
          }],
        }],
        nasVolumeMounts: {
          main: [{
            mountPath: "/var/lib/mysql",
            subPath: "cluster/kimai/mariadb",
          }],
        },
      },
    });

    new Application(this, {
      name: "kimai",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "hub.int.lab53.net/kimai/kimai2:apache",
          env: [{
            name: "DATABASE_URL",
            valueFrom: {
              secretKeyRef: {
                name: kimaiDBPass.name,
                key: "connectionString",
              },
            },
          }, {
            name: "APP_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: appSecret.name,
                key: "secret",
              },
            },
          }, {
            name: "ADMINPASS",
            valueFrom: {
              secretKeyRef: {
                name: adminPass.name,
                key: "password",
              },
            },
          }],
          ports: [{ containerPort: 8001 }],
        }],
      },
      webPort: 8001,
    });
  }
}

const app = new Lab53App();
new Kimai(app);
app.synth();
