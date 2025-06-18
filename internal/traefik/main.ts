import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App, readTextFileFromInitCwd } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";
import ServerTransport from "../../shared/traefik/ServerTransport.ts";

export class TraefikInternal extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new HelmChart(this, {
      name: "traefik",
      repo: "https://traefik.github.io/charts",
      values: readTextFileFromInitCwd("values.yaml"),
    });

    new ServerTransport(this, {
      name: "insecuretransport",
      spec: {
        insecureSkipVerify: true,
      },
    });
  }
}

const app = new Lab53App();
new TraefikInternal(app, "traefik-internal");
app.synth();
