import { buildNasPersistentVolumePair } from "../storage";
import type { HelmChart, StaticApp } from "../types";
import { readFile } from "../utils";

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
    valuesContent: await readFile(
      "./pocket-id/values.yaml",
      import.meta.url,
    ),
  },
};

const config: StaticApp = {
  kind: "static",
  name: "pocket-id",
  resources: [dataPv, dataPvc, chart],
};

export default config;
