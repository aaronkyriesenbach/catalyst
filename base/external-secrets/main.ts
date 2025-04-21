import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { createResourcesFromYaml } from "../../shared/helpers.ts";
import { ClusterGenerator, ClusterGeneratorSpecKind } from "../../shared/imports/generators.external-secrets.io.ts";
import Application from "../../shared/Application.ts";

export class ExternalSecrets extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    createResourcesFromYaml(this, "external-secrets/crds.yaml", {
      readFromShared: true,
    });
    createResourcesFromYaml(
      this,
      "external-secrets/external-secrets-v0.16.1.yaml",
      {
        readFromShared: true,
      },
    );

    new Application(this, {
      name: "secretgen",
      podSpecProps: {
        containers: [{
          name: "secretgen",
          image: "ghcr.io/aaronkyriesenbach/secretgen:v0.0.1",
          ports: [{ name: "api", containerPort: 8080 }],
        }],
      },
    });

    let passwordWebhookUrl = "http://secretgen/password?";
    for (let i = 0; i < 10; i++) {
      passwordWebhookUrl += `names[]=secretKey${i}&`;
    }
    new ClusterGenerator(this, crypto.randomUUID(), {
      metadata: {
        name: "password-generator",
      },
      spec: {
        kind: ClusterGeneratorSpecKind.WEBHOOK,
        generator: {
          webhookSpec: {
            url: passwordWebhookUrl,
            result: {
              jsonPath: "$.args",
            },
          },
        },
      },
    });

    new ClusterGenerator(this, crypto.randomUUID(), {
      metadata: {
        name: "private-key-generator",
      },
      spec: {
        kind: ClusterGeneratorSpecKind.WEBHOOK,
        generator: {
          webhookSpec: {
            url: "http://secretgen/ecdsa",
            result: {
              jsonPath: "$.args",
            },
          },
        },
      },
    });
  }
}
