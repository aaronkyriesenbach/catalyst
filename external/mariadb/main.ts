import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";

class MariaDB extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "mariadb-operator-crds",
      repo: "https://helm.mariadb.com/mariadb-operator",
      version: "25.8.3",
      namespace: "mariadb",
    });

    new HelmChart(this, {
      name: "mariadb-operator",
      repo: "https://helm.mariadb.com/mariadb-operator",
      version: "25.8.3",
      namespace: "mariadb",
    });
  }
}

const app = new Lab53App();
new MariaDB(app);
app.synth();
