import { Construct } from "constructs";
import { Chart } from "cdk8s";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";

export class CloudNativePostgres extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "cnpg-system" });

    createResourcesFromYaml(this, "cnpg-1.25.1.yaml");
  }
}

const app = new Lab53App();
new CloudNativePostgres(app, "cloudnativepostgres");
app.synth();
