import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class Collabora extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new GeneratedPassword(this, {
      name: "admin-secret",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          username: "aaron",
          password: "$(value)",
        },
      },
    });

    new IngressRoute(this, {
      name: "collabora",
      service: {
        name: "collabora-collabora-online",
        port: 9980,
      },
      ingressRouteSpec: {
        useForwardAuth: false,
      },
    });

    createResourcesFromYaml(this, "collabora-chart.yaml");
  }
}

const app = new Lab53App();
new Collabora(app, "collabora");
app.synth();
