import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";
import {
  ClusterGenerator,
  ClusterGeneratorSpecKind,
} from "../../shared/imports/generators.external-secrets.io.ts";

class ExternalSecrets extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "external-secrets",
      repo: "https://charts.external-secrets.io",
      version: "0.19.2",
    });

    new ClusterGenerator(this, crypto.randomUUID(), {
      metadata: {
        name: "secret-generator",
      },
      spec: {
        kind: ClusterGeneratorSpecKind.PASSWORD,
        generator: {
          passwordSpec: {
            length: 32,
            allowRepeat: true,
            noUpper: false,
            symbolCharacters: "~!@#$%^&*()_+-=|[]:<>?,./", // Don't use characters that could interface with templating
          },
        },
      },
    });
  }
}

const app = new Lab53App();
new ExternalSecrets(app);
app.synth();
