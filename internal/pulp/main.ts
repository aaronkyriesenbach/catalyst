import { ApiObject, Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";

class Pulp extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "pulp",
      repo: "https://github.com/pulp/pulp-k8s-resources/raw/main/helm-charts",
      chartName: "pulp-operator",
      version: "0.3.0",
    });

    new ApiObject(this, crypto.randomUUID(), {
      apiVersion: "repo-manager.pulpproject.org/v1",
      kind: "Pulp",
      metadata: {
        name: "pulp",
      },
      spec: {
        api: {
          replicas: 1,
        },
        content: {
          replicas: 1,
        },
        worker: {
          replicas: 1,
        },
      },
    });
  }
}

const app = new Lab53App();
new Pulp(app);
app.synth();
