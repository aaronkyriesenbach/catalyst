import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App, readTextFile } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import ConfigMap from "../../shared/k8s/ConfigMap.ts";

class MonkeyType extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new Application(this, {
      name: "redis",
      podSpecProps: {
        containers: [{
          name: "redis",
          image: "hub.int.lab53.net/library/redis:6.2.6",
          readinessProbe: {
            exec: {
              command: ["redis-cli", "--raw", "incr", "ping"],
            },
          },
          ports: [{ containerPort: 6379 }],
        }],
        nasVolumeMounts: {
          redis: [{
            mountPath: "/data",
            subPath: "cluster/monkeytype/redis",
          }],
        },
      },
    });

    new Application(this, {
      name: "mongo",
      podSpecProps: {
        containers: [{
          name: "mongo",
          image: "hub.int.lab53.net/library/mongo:5.0.13",
          readinessProbe: {
            exec: {
              command: [
                "echo",
                "'db.stats().ok'",
                "|",
                "mongo",
                "localhost:27017/test",
                "--quiet",
              ],
            },
          },
          ports: [{ containerPort: 27017 }],
        }],
        nasVolumeMounts: {
          mongo: [{
            mountPath: "/data/db",
            subPath: "cluster/monkeytype/mongo",
          }],
        },
      },
    });

    const config = new ConfigMap(this, {
      name: "backend-config",
      data: {
        "backend-configuration.json": readTextFile(
          "backend-configuration.json",
        ),
      },
    });

    new Application(this, {
      name: "backend",
      podSpecProps: {
        containers: [{
          name: "backend",
          image: "hub.int.lab53.net/monkeytype/monkeytype-backend:latest",
          env: [{
            name: "FRONTEND_URL",
            value: "http://monkeytype",
          }, {
            name: "DB_NAME",
            value: "monkeytype",
          }, {
            name: "DB_URI",
            value: "mongodb://mongo:27017",
          }, {
            name: "REDIS_URI",
            value: "redis://redis:6379",
          }],
          ports: [{ containerPort: 5005 }],
          volumeMounts: [{
            name: config.name,
            mountPath: "/app/backend/dist/backend-configuration.json",
            subPath: "backend-configuration.json",
            readOnly: true,
          }],
        }],
        volumes: [{
          name: config.name,
          configMap: {
            name: config.name,
          },
        }],
      },
      webPort: 5005,
      ingressRouteSpec: {
        customHostname: "api.monkeytype",
        middlewares: [{
          name: "tinyauth",
          namespace: "tinyauth"
        }]
      }
    });

    new Application(this, {
      name: "monkeytype",
      podSpecProps: {
        containers: [{
          name: "frontend",
          image: "hub.int.lab53.net/monkeytype/monkeytype-frontend:latest",
          env: [{
            name: "MONKEYTYPE_BACKENDURL",
            value: "https://api.monkeytype.lab53.net",
          }],
          ports: [{ containerPort: 80 }],
        }],
        securityContext: undefined
      },
      webPort: 80,
      ingressRouteSpec: {
        middlewares: [{
          name: "tinyauth",
          namespace: "tinyauth",
        }],
      },
    });
  }
}

const app = new Lab53App();
new MonkeyType(app);
app.synth();
