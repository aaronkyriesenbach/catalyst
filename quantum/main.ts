import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App, readTextFileSync } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";
import ConfigMap from "../shared/ConfigMap.ts";
import ConfigPVC from "../shared/ConfigPVC.ts";
import { Quantity } from "../shared/imports/k8s.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";

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

    const officeSecret = new GeneratedPassword(this, { name: "office-secret" });

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
          image: "ghcr.io/aaronkyriesenbach/filebrowser:0.6.8-beta",
          ports: [{ containerPort: 80, name: "web" }],
          env: [{
            name: "FILEBROWSER_CONFIG",
            value: "/config/config.yaml",
          }, {
            name: "FILEBROWSER_ONLYOFFICE_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: officeSecret.name,
                key: "password",
              },
            },
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

    new Application(this, {
      name: "onlyoffice",
      podSpecProps: {
        containers: [{
          name: "onlyoffice",
          image: "onlyoffice/documentserver:8.3.2",
          ports: [{ containerPort: 80, name: "web" }],
          env: [{
            name: "JWT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: officeSecret.name,
                key: "password",
              },
            },
          }],
        }],
      },
      webPort: 80,
      ingressRouteSpec: {
        useForwardAuth: false,
      },
    });
  }
}

const app = new Lab53App();
new Quantum(app, "quantum");
app.synth();
