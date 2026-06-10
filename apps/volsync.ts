import { Project } from "../constants";
import type { HelmChart, StaticApp } from "../types";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "volsync",
  },
  spec: {
    repo: "https://backube.github.io/helm-charts",
    chart: "volsync",
    targetNamespace: "volsync-system",
    version: "0.15.0",
  },
};

const config: StaticApp = {
  kind: "static",
  name: "volsync",
  namespace: "volsync-system",
  project: Project.SYSTEM,
  resources: [chart],
};

export default config;
