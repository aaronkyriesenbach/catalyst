import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import Application from "../../shared/Application.ts";
import GeneratedSecret from "../../shared/mittwald-secret-gen/GeneratedSecret.ts";

class MPMonitor extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const dbPass = new GeneratedSecret(this, {
      name: "db-pass",
      fieldsToGenerate: ["password"],
    });

    const jwtSecret = new GeneratedSecret(this, {
      name: "jwt-secret",
      fieldsToGenerate: ["secret"],
    });

    new Application(this, {
      name: "postgres",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "hub.int.lab53.net/library/postgres:17-alpine",
          env: [{
            name: "POSTGRES_USER",
            value: "mpmonitor",
          }, {
            name: "POSTGRES_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: dbPass.name,
                key: "password",
              },
            },
          }],
          ports: [{ containerPort: 5432 }],
        }],
        nasVolumeMounts: {
          main: [{
            mountPath: "/var/lib/postgresql/data",
            subPath: "cluster/mpmonitor/postgres",
          }],
        },
      },
    });

    new Application(this, {
      name: "api",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "registry.int.lab53.net/mpmonitor/api:1.0.0-SNAPSHOT",
          env: [{
            name: "DB_HOST",
            value: "postgres",
          }, {
            name: "DB_USER",
            value: "mpmonitor",
          }, {
            name: "DB_PASS",
            valueFrom: {
              secretKeyRef: {
                name: dbPass.name,
                key: "password",
              },
            },
          }, {
            name: "DB_NAME",
            value: "mpmonitor",
          }, {
            name: "JWT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: jwtSecret.name,
                key: "secret",
              },
            },
          }, {
            name: "ACCESS_CODE",
            valueFrom: {
              secretKeyRef: {
                name: "access-code",
                key: "code",
              },
            },
          }, {
            name: "NTFY_HOST",
            value: "https://ntfy.lab53.net",
          }, {
            name: "NTFY_TOKEN",
            valueFrom: {
              secretKeyRef: {
                name: "ntfy-token",
                key: "token",
              },
            },
          }],
          ports: [{ containerPort: 8080 }],
        }],
      },
      webPort: 8080,
      ingressRouteSpec: {
        customHostname: "api.mpmonitor",
      },
    });

    new Application(this, {
      name: "ui",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "registry.int.lab53.net/mpmonitor/ui:1.0.0-SNAPSHOT",
          env: [{
            name: "VITE_API_HOST",
            value: "https://api.mpmonitor.lab53.net",
          }],
          ports: [{ containerPort: 80 }],
        }],
      },
      webPort: 80,
      ingressRouteSpec: {
        customHostname: "mpmonitor",
      },
    });
  }
}

const app = new Lab53App();
new MPMonitor(app);
app.synth();
