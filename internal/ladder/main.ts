import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { INTERNAL_SUBDOMAIN } from "../../shared/constants.ts";

export class Ladder extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "ladder",
      podSpecProps: {
        containers: [{
          name: "ladder",
          image: "ghcr.int.lab53.net/everywall/ladder:latest",
          ports: [{ containerPort: 8080 }],
          env: [{
            name: "RULESET",
            value:
              "https://raw.githubusercontent.com/everywall/ladder-rules/main/ruleset.yaml",
          }],
        }],
      },
      webPort: 8080,
      ingressRouteSpec: {
        subdomain: INTERNAL_SUBDOMAIN,
      },
    });
  }
}

const app = new Lab53App();
new Ladder(app, "ladder");
app.synth();
