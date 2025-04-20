import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import {
  Certificate,
  CertificateSpecPrivateKeyAlgorithm,
  CertificateSpecPrivateKeyRotationPolicy
} from "../shared/imports/cert-manager.io.ts";
import { Bundle } from "../shared/imports/trust.cert-manager.io.ts";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";
import { KubeNamespace } from "../shared/imports/k8s.ts";

export class Linkerd extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "linkerd" });

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

    createResourcesFromYaml(this, "cert-manager-rbac.yaml");
    createResourcesFromYaml(this, "linkerd-crds.yaml");
    createResourcesFromYaml(this, "linkerd2-cni-edge-25.4.3.yaml");
    createResourcesFromYaml(this, "linkerd-edge-25.4.3.yaml");
  }
}

const app = new Lab53App();
new Linkerd(app, "linkerd");
app.synth();
