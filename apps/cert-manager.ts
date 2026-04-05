import { AppConfig } from "../types";

const chart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "cert-manager",
  },
  spec: {
    repo: "oci://quay.io/jetstack/charts",
    // chart: "cert-manager",
    // version: "v1.20.1",
    // set: {
    //   "crds.enabled": true,
    // },
  },
};

const cm = {
  apiVersion: "v1",
  kind: "ConfigMap",
  metadata: {
    name: "test",
  },
};

const config: AppConfig = {
  name: "cert-manager",
  extraResources: [cm],
};

export default config;
