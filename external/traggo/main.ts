import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import GeneratedSecret from "../../shared/mittwald-secret-gen/GeneratedSecret.ts";

class Traggo extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const adminSecret = new GeneratedSecret(this, {
      name: "traggo-admin-secret",
      fieldsToGenerate: ["secret"],
    });

    new Application(this, {
      name: "traggo",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "hub.int.lab53.net/traggo/server:latest",
          ports: [{ containerPort: 3030 }],
          env: [{
            name: "TRAGGO_DEFAULT_USER_PASS",
            valueFrom: {
              secretKeyRef: {
                name: adminSecret.name,
                key: "secret",
              },
            },
          }],
        }],
        nasVolumeMounts: {
          main: [{
            mountPath: "/opt/traggo/data",
            subPath: "cluster/traggo/data",
          }],
        },
      },
      webPort: 3030,
    });
  }
}

const app = new Lab53App();
new Traggo(app);
app.synth();
