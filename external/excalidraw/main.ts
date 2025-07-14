import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import Application from "../../shared/Application.ts";
import { Lab53App } from "../../shared/helpers.ts";

export class Excalidraw extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "excalidraw",
      podSpecProps: {
        containers: [{
          name: "excalidraw",
          image: "registry.int.lab53.net/excalidraw/excalidraw:latest",
          ports: [{ containerPort: 80, name: "web" }],
        }],
      },
      webPort: 80,
      ingressRouteSpec: {
        customHostname: "draw",
      },
    });
  }
}

const app = new Lab53App();
new Excalidraw(app, "excalidraw");
app.synth();
