import { Project } from "../constants";
import type { HelmChart, StaticApp } from "../types";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "reloader",
  },
  spec: {
    repo: "https://stakater.github.io/stakater-charts",
    chart: "reloader",
    targetNamespace: "reloader",
    version: "2.2.12",
  },
};

const config: StaticApp = {
  kind: "static",
  name: "reloader",
  project: Project.SYSTEM,
  resources: [chart],
};

export default config;
