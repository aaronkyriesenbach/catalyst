import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";

export class Nextcloud extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "nextcloud",
      podSpecProps: {
        containers: [{
          name: "nextcloud-aio",
          image: "ghcr.io/nextcloud-releases/aio-nextcloud:20250408_081359",
          ports: [{ containerPort: 8080, name: "web" }],
        }],
      },
      webPort: 8080,
      ingressRouteSpec: {
        useForwardAuth: false,
      },
    });
  }
}

const app = new Lab53App();
new Nextcloud(app, "nextcloud");
app.synth();
