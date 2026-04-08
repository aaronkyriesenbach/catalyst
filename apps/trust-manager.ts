import type { HelmChart, ResourceLike, StaticApp } from "../types";
import { certManagerNamespace } from "./cert-manager";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "trust-manager",
  },
  spec: {
    chart: "oci://quay.io/jetstack/charts/trust-manager",
    targetNamespace: certManagerNamespace,
    version: "v0.22.0",
  },
};

const internalRootCaBundle: ResourceLike = {
  apiVersion: "trust.cert-manager.io/v1alpha1",
  kind: "Bundle",
  metadata: {
    name: "internal-root-ca-bundle",
  },
  spec: {
    sources: [
      {
        secret: {
          name: "internal-root-ca",
          key: "ca.crt",
        },
      },
    ],
    target: {
      configMap: {
        key: "ca.crt",
      },
      namespaceSelector: {
        matchLabels: {
          "kubernetes.io/metadata.name": "traefik",
        },
      },
    },
  },
};

const config: StaticApp = {
  kind: "static",
  name: "trust-manager",
  namespace: certManagerNamespace,
  resources: [chart, internalRootCaBundle],
};

export default config;
