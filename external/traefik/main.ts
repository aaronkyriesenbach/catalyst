import { Construct } from "constructs";
import { Chart } from "cdk8s";
import ServerTransport from "../../shared/traefik/ServerTransport.ts";
import { Lab53App, readTextFileFromInitCwd } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";

export class Traefik extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "traefik" });

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
new Traefik(app, "traefik");
app.synth();
