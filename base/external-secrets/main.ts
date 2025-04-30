import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { ClusterGenerator, ClusterGeneratorSpecKind } from "../../shared/imports/generators.external-secrets.io.ts";
import {
  ClusterSecretStore,
  ClusterSecretStoreSpecProviderAwsService
} from "../../shared/imports/external-secrets.io.ts";
import { HelmChart } from "../../shared/HelmChart.ts";

export class ExternalSecrets extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new HelmChart(this, {
      name: "external-secrets",
      repo: "https://charts.external-secrets.io",
    });

    new ClusterGenerator(this, crypto.randomUUID(), {
      metadata: {
        name: "password-gen",
      },
      spec: {
        kind: ClusterGeneratorSpecKind.PASSWORD,
        generator: {
          passwordSpec: {
            length: 64,
            allowRepeat: true,
            noUpper: false,
          },
        },
      },
    });

    new ClusterSecretStore(this, crypto.randomUUID(), {
      metadata: {
        name: "lab53-secret-store",
      },
      spec: {
        provider: {
          aws: {
            service: ClusterSecretStoreSpecProviderAwsService.SECRETS_MANAGER,
            region: "us-east-1",
            auth: {
              secretRef: {
                accessKeyIdSecretRef: {
                  name: "aws-creds",
                  key: "access-key-id",
                },
                secretAccessKeySecretRef: {
                  name: "aws-creds",
                  key: "secret-access-key",
                },
              },
            },
          },
        },
      },
    });
  }
}
