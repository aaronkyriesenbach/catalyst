import { Construct } from "npm:constructs";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy
} from "../../shared/imports/cert-manager.io.ts";
import { Bundle } from "../../shared/imports/trust.cert-manager.io.ts";
import { createResourcesFromYaml } from "../../shared/helpers.ts";
import { KubeNamespace } from "../../shared/imports/k8s.ts";
import { Chart } from "npm:cdk8s";

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
    createResourcesFromYaml(this, "./linkerd/linkerd-crds.yaml", {
      readFromShared: true,
    });
    createResourcesFromYaml(this, "./linkerd/linkerd2-cni-edge-25.4.3.yaml", {
      readFromShared: true,
    });
    createResourcesFromYaml(this, "./linkerd/linkerd-edge-25.4.3.yaml", {
      readFromShared: true,
    });
  }
}
