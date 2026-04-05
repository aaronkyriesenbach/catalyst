import { ConfigMap } from "kubernetes-models/v1";
import { AppConfig } from "../types";

const chart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "cert-manager",
  },
  spec: {
    repo: "oci://quay.io/jetstack/charts",
    chart: "cert-manager",
    targetNamespace: "cert-manager",
    version: "v1.20.1",
    set: {
      "crds.enabled": "true",
    },
  },
};

const config: AppConfig = {
  name: "cert-manager",
  extraResources: [chart],
};

export default config;
