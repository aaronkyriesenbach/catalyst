import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy,
  ClusterIssuer,
  Issuer
} from "../shared/imports/cert-manager.io.ts";

export class CertManager extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "cert-manager" });

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

    createResourcesFromYaml(this, "cert-manager-v1.17.1.yaml");
    createResourcesFromYaml(this, "trust-manager-v0.16.0.yaml");
  }
}

const app = new Lab53App();
new CertManager(app, "cert-manager");
app.synth();
