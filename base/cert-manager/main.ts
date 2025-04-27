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

export class CertManager extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new HelmChart(this, {
      name: "cert-manager",
      repo: "https://charts.jetstack.io",
    });

    new HelmChart(this, {
      name: "trust-manager",
      namespace: "cert-manager",
      repo: "https://charts.jetstack.io",
    });

    new ClusterIssuer(this, crypto.randomUUID(), {
      metadata: {
        name: "lab53-cluster-issuer",
      },
      spec: {
        acme: {
          email: "aaron@kyriesenba.ch",
          server: "https://acme-staging-v02.api.letsencrypt.org/directory",
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

    const issuer = new Issuer(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd-trust-root-issuer",
      },
      spec: {
        selfSigned: {},
      },
    });

    new Certificate(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd-trust-anchor",
      },
      spec: {
        issuerRef: {
          kind: "Issuer",
          name: issuer.name,
        },
        secretName: "linkerd-trust-anchor",
        isCa: true,
        commonName: "root.linkerd.cluster.local",
        duration: "8760h0m0s",
        renewBefore: "7320h0m0s",
        privateKey: {
          rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.ALWAYS,
          algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        },
      },
    });

    new ClusterIssuer(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd-identity-issuer",
      },
      spec: {
        ca: {
          secretName: "linkerd-trust-anchor",
        },
      },
    });
  }
}
