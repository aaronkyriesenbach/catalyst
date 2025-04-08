import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App, readTextFileSync } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";
import ConfigMap from "../shared/ConfigMap.ts";
import ConfigPVC from "../shared/ConfigPVC.ts";
import { Quantity } from "../shared/imports/k8s.ts";

export class Quantum extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const config = new ConfigMap(this, {
      name: "config",
      data: {
        "config.yaml": readTextFileSync("config.yaml"),
      },
    });

    const database = new ConfigPVC(this, {
      name: "database",
      size: Quantity.fromString("1Gi"),
    });

    new Application(this, {
      name: "quantum",
      podSpecProps: {
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
        },
        nasVolumeMounts: {
          quantum: [{
            mountPath: "/data",
            subPath: "documents",
          }],
        },
        containers: [{
          name: "quantum",
          image: "gtstef/filebrowser:0.6.8-beta",
          ports: [{ containerPort: 80, name: "web" }],
          env: [{
            name: "FILEBROWSER_CONFIG",
            value: "/config/config.yaml",
          }],
          volumeMounts: [{
            name: config.name,
            mountPath: "/config",
          }, {
            name: database.name,
            mountPath: "/database",
          }],
        }],
        volumes: [{
          name: config.name,
          configMap: {
            name: config.name,
          },
        }, {
          name: database.name,
          persistentVolumeClaim: {
            claimName: database.name,
          },
        }],
      },
      webPort: 80,
    });
  }
}

const app = new Lab53App();
new Quantum(app, "quantum");
app.synth();
