import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";

export class SecretgenController extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "secretgen-controller" });

    createResourcesFromYaml(this, "sgc-v0.19.1.yaml");
  }
}

const app = new Lab53App();
new SecretgenController(app, "secretgen-controller");
app.synth();
