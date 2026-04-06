import { AppConfig, HelmChart } from "../types";

const internalChart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "external-dns-int",
  },
  spec: {
    repo: "https://kubernetes-sigs.github.io/external-dns/",
    chart: "external-dns",
    targetNamespace: "external-dns",
    version: "1.20.0",
    valuesContent: await Bun.file(
      new URL("./external-dns/internal-values.yaml", import.meta.url),
    ).text(),
  },
};

const config: AppConfig = {
  name: "external-dns",
  extraResources: [internalChart],
};

export default config;
