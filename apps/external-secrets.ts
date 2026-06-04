import { IGeneratorRef } from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { ClusterGenerator } from "@kubernetes-models/external-secrets/generators.external-secrets.io/v1alpha1";
import type { HelmChart, StaticApp } from "../types";

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

const clusterGeneratorName = "generated-password";

const clusterGenerator: ClusterGenerator = new ClusterGenerator({
  metadata: {
    name: clusterGeneratorName,
  },
  spec: {
    kind: "Password",
    generator: {
      passwordSpec: {
        length: 16,
        allowRepeat: true,
        noUpper: false,
      },
    },
  },
});

export const clusterGeneratorRef: IGeneratorRef = {
  apiVersion: clusterGenerator.apiVersion,
  kind: clusterGenerator.kind,
  name: clusterGeneratorName,
};

const config: StaticApp = {
  kind: "static",
  name: "external-secrets",
  resources: [chart, clusterGenerator],
};

export default config;
