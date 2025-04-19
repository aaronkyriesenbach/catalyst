import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { generateArgoCDApps, Lab53App } from "../shared/helpers.ts";

export class CatalystInternal extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    generateArgoCDApps(this, "internal");
  }
}

const app = new Lab53App();
new CatalystInternal(app, "catalyst-internal");
app.synth();
