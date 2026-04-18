import type { HelmChart, ResourceLike, StaticApp } from "../types";
import { GENERATED_PASSWORD_GENERATOR_NAME } from "../utils";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "external-secrets",
  },
  spec: {
    repo: "https://charts.external-secrets.io",
    chart: "external-secrets",
    targetNamespace: "external-secrets",
    version: "2.3.0",
    set: {
      installCRDs: "true",
    },
  },
};

const clusterGenerator: ResourceLike = {
  apiVersion: "generators.external-secrets.io/v1alpha1",
  kind: "ClusterGenerator",
  metadata: {
    name: GENERATED_PASSWORD_GENERATOR_NAME,
  },
  spec: {
    kind: "Password",
    generator: {
      passwordSpec: {
        length: 64,
        encoding: "hex",
        allowRepeat: true,
      },
    },
  },
};

const config: StaticApp = {
  kind: "static",
  name: "external-secrets",
  resources: [chart, clusterGenerator],
};

export default config;
