import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";

export class Filestash extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "filestash",
      podSpecProps: {
        containers: [{
          name: "filestash",
          image: "machines/filestash:latest",
          ports: [{ containerPort: 8334, name: "web" }],
        }],
      },
      webPort: 8334,
    });
  }
}

const app = new Lab53App();
new Filestash(app, "filestash");
app.synth();
