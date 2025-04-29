import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import ConfigPVC from "../../shared/ConfigPVC.ts";

export class Ladder extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const testPVC = new ConfigPVC(this, { name: "test", accessMode: "ReadWriteMany" });

    new Application(this, {
      name: "ladder",
      podSpecProps: {
        volumes: [{
          name: testPVC.name,
          persistentVolumeClaim: {
            claimName: testPVC.name,
          },
        }],
        containers: [{
          name: "ladder",
          image: "ghcr.io/everywall/ladder:latest",
          ports: [{ containerPort: 8080 }],
          env: [{
            name: "RULESET",
            value:
              "https://raw.githubusercontent.com/everywall/ladder-rules/main/ruleset.yaml",
          }],
          volumeMounts: [{
            name: testPVC.name,
            mountPath: "/test",
          }],
        }],
      },
      webPort: 8080,
      ingressRouteSpec: {
        useInsecureTransport: true,
      },
    });
  }
}

const app = new Lab53App();
new Ladder(app, "ladder");
app.synth();
