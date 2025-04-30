import { Construct } from "npm:constructs";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy,
  ClusterIssuer,
  Issuer
} from "../../shared/imports/cert-manager.io.ts";
import { Chart } from "npm:cdk8s";
import { HelmChart } from "../../shared/HelmChart.ts";
import { readTextFileFromBaseDir } from "../../shared/helpers.ts";

export class CertManager extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new HelmChart(this, {
      name: "cert-manager",
      repo: "https://charts.jetstack.io",
      values: readTextFileFromBaseDir("cert-manager/values.yaml")
    });

    new HelmChart(this, {
      name: "trust-manager",
      namespace: "cert-manager",
      repo: "https://charts.jetstack.io",
    });

    new ClusterIssuer(this, crypto.randomUUID(), {
      metadata: {
        name: "letsencrypt",
      },
      spec: {
        acme: {
          email: "aaron@kyriesenba.ch",
          server: "https://acme-v02.api.letsencrypt.org/directory",
          privateKeySecretRef: {
            name: "le-private-key",
          },
          solvers: [{
            dns01: {
              route53: {
                region: "us-east-1",
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
          }],
        },
      },
    });

    new ClusterIssuer(this, crypto.randomUUID(), {
      metadata: {
        name: "letsencrypt-staging",
      },
      spec: {
        acme: {
          email: "aaron@kyriesenba.ch",
          server: "https://acme-staging-v02.api.letsencrypt.org/directory",
          privateKeySecretRef: {
            name: "le-staging-private-key",
          },
          solvers: [{
            dns01: {
              route53: {
                region: "us-east-1",
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
          }],
        },
      },
    });
  }
}
