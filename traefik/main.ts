import { Construct } from "constructs";
import { Chart } from "cdk8s";
import ServerTransport from "../shared/ServerTransport.ts";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";

export class Traefik extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "traefik" });

    new ServerTransport(this, {
      name: "insecuretransport",
      spec: {
        insecureSkipVerify: true,
      },
    });

    createResourcesFromYaml(this, "traefik-chart.yaml");
  }
}

const app = new Lab53App();
new Traefik(app, "traefik");
app.synth();
