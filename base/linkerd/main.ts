import { Construct } from "npm:constructs";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy,
  ClusterIssuer,
  Issuer
} from "../../shared/imports/cert-manager.io.ts";
import { Bundle } from "../../shared/imports/trust.cert-manager.io.ts";
import { createResourcesFromYaml, readTextFileFromBaseDir } from "../../shared/helpers.ts";
import { KubeNamespace } from "../../shared/imports/k8s.ts";
import { Chart } from "npm:cdk8s";
import { HelmChart } from "../../shared/HelmChart.ts";

export class Linkerd extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new KubeNamespace(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd",
        labels: {
          "linkerd.io/is-control-plane": "true",
        },
      },
    });

    const issuer = new Issuer(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd-trust-root-issuer",
        namespace: "cert-manager",
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
        namespace: "cert-manager",
      },
      spec: {
        ca: {
          secretName: "linkerd-trust-anchor",
        },
      },
    });

    new Certificate(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd-identity-issuer",
      },
      spec: {
        issuerRef: {
          name: "linkerd-identity-issuer",
          kind: "ClusterIssuer",
        },
        secretName: "linkerd-identity-issuer",
        isCa: true,
        commonName: "identity.linkerd.cluster.local",
        duration: "48h0m0s",
        renewBefore: "25h0m0s",
        privateKey: {
          rotationPolicy: CertificateSpecPrivateKeyRotationPolicy.ALWAYS,
          algorithm: CertificateSpecPrivateKeyAlgorithm.ECDSA,
        },
      },
    });

    new Bundle(this, crypto.randomUUID(), {
      metadata: {
        name: "linkerd-identity-trust-roots",
      },
      spec: {
        sources: [{
          secret: {
            name: "linkerd-trust-anchor",
            key: "tls.crt",
          },
        }, {
          secret: {
            name: "linkerd-previous-anchor",
            key: "tls.crt",
          },
        }],
        target: {
          configMap: {
            key: "ca-bundle.crt",
          },
          namespaceSelector: {
            matchLabels: {
              "linkerd.io/is-control-plane": "true",
            },
          },
        },
      },
    });

    createResourcesFromYaml(this, "./linkerd/cert-manager-rbac.yaml", {
      readFromShared: true,
    });

    new HelmChart(this, {
      name: "linkerd-crds",
      repo: "https://helm.linkerd.io/stable",
    });

    new HelmChart(this, {
      name: "linkerd-control-plane",
      repo: "https://helm.linkerd.io/stable",
      values: readTextFileFromBaseDir("linkerd/control-plane-values.yaml"),
    });
  }
}
