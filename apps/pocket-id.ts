import { buildNasPersistentVolumePair } from "../storage";
import type { HelmChart, StaticApp } from "../types";

const { pv: dataPv, pvc: dataPvc } = buildNasPersistentVolumePair({
  name: "pocket-id-data",
  storage: "5Gi",
  nfsPath: "/mnt/tank/data/cluster/pocket-id/data",
});

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "pocket-id-operator",
  },
  spec: {
    chart: "oci://ghcr.io/aclerici38/charts/pocket-id-operator",
    targetNamespace: "pocket-id",
    version: "0.5.2",
    valuesContent: await Bun.file(
      new URL("./pocket-id/values.yaml", import.meta.url),
    ).text(),
  },
};

const config: StaticApp = {
  kind: "static",
  name: "pocket-id",
  resources: [dataPv, dataPvc, chart],
};

export default config;
