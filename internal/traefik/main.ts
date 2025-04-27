import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App, readTextFileFromInitCwd } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";
import { Lab53WildcardCert } from "../../shared/Lab53WildcardCert.ts";

export class TraefikInternal extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new HelmChart(this, {
      name: "traefik",
      repo: "https://traefik.github.io/charts",
      values: readTextFileFromInitCwd("values.yaml"),
    });

    new Lab53WildcardCert(this, {
      subdomain: "int" // *.int.lab53.net
    })
  }
}

const app = new Lab53App();
new TraefikInternal(app, "traefik-internal");
app.synth();
