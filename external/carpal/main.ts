import { Construct } from "npm:constructs";
import { Lab53App, readTextFileFromInitCwd } from "../../shared/helpers.ts";
import { Chart } from "npm:cdk8s";
import Application from "../../shared/Application.ts";
import SecretImport from "../../shared/secretgen/SecretImport.ts";
import ConfigMap from "../../shared/k8s/ConfigMap.ts";

export class Carpal extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const config = new ConfigMap(this, {
      name: "config",
      data: {
        "oidc.gotempl": readTextFileFromInitCwd("oidc.gotempl"),
      },
    });

    const configSecret = new SecretImport(this, {
      name: "carpal-user-config",
      fromNamespace: "lldap",
    });

    new Application(this, {
      name: "carpal",
      podSpecProps: {
        volumes: [{
          name: configSecret.name,
          secret: {
            secretName: configSecret.name,
          },
        }, {
          name: config.name,
          configMap: {
            name: config.name,
          },
        }],
        containers: [{
          name: "carpal",
          image: "peeley/carpal:1.1.1",
          ports: [{ containerPort: 8008, name: "web" }],
          volumeMounts: [{
            name: configSecret.name,
            mountPath: "/etc/carpal/config.yml",
            subPath: "config.yml",
          }, {
            name: config.name,
            mountPath: "/etc/carpal/oidc.gotempl",
            subPath: "oidc.gotempl",
          }],
        }],
      },
      webPort: 8008,
      ingressRouteSpec: {
        matchOverride: "Host(`lab53.net`) && Path(`/.well-known/webfinger`)",
        useForwardAuth: false,
      },
    });
  }
}

const app = new Lab53App();
new Carpal(app, "carpal");
app.synth();
