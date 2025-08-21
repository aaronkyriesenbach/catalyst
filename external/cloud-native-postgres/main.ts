import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";

class CloudNativePostgres extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "cloudnative-pg",
      repo: "https://cloudnative-pg.github.io/charts",
      namespace: "cnpg-system",
    });
  }
}

const app = new Lab53App();
new CloudNativePostgres(app);
app.synth();
