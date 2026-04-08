import type { HelmChart, StaticApp } from "../types";
import { internalCaResources } from "./cert-manager/internal-ca";
import { issuers } from "./cert-manager/issuers";

export const certManagerNamespace = "cert-manager";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "cert-manager",
  },
  spec: {
    chart: "oci://quay.io/jetstack/charts/cert-manager",
    targetNamespace: certManagerNamespace,
    version: "v1.20.1",
    set: {
      "crds.enabled": "true",
    },
  },
};

const config: StaticApp = {
  kind: "static",
  name: "cert-manager",
  resources: [chart, ...issuers, ...internalCaResources],
};

export default config;
