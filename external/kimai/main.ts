import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import GeneratedSecret from "../../shared/mittwald-secret-gen/GeneratedSecret.ts";

class Kimai extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const kamaiDBPass = new GeneratedSecret(this, {
      name: "kamai-db-pass",
      fieldsToGenerate: ["secret"],
    });

    const appSecret = new GeneratedSecret(this, {
      name: "kamai-app-secret",
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
            value: "kamai",
          }, {
            name: "MARIADB_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: kamaiDBPass.name,
                key: "secret",
              },
            },
          }, {
            name: "MARIADB_DATABASE",
            value: "kamai",
          }, {
            name: "MARIADB_RANDOM_ROOT_PASSWORD",
            value: "true",
          }],
        }],
        nasVolumeMounts: {
          main: [{
            mountPath: "/var/lib/mysql",
            subPath: "cluster/kamai/mariadb",
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
            name: "DATABASE_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: kamaiDBPass.name,
                key: "secret",
              },
            },
          }, {
            name: "DATABASE_URL",
            value:
              `mysql://kamai:$DATABASE_PASSWORD@mariadb:3306/kimai?charset=utf8mb4`,
          }, {
            name: "APP_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: appSecret.name,
                key: "secret",
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
