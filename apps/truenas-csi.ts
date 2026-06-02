import { parseAllDocuments } from "yaml";
import type { ResourceLike, StaticApp } from "../types";
import { readFile } from "../utils";

const deployYaml = await readFile("./truenas-csi/deploy.yaml", import.meta.url);

const deployResources = parseAllDocuments(deployYaml)
  .map((doc) => doc.toJSON() as ResourceLike)
  .filter(Boolean);

const storageClass: ResourceLike = {
  apiVersion: "storage.k8s.io/v1",
  kind: "StorageClass",
  metadata: {
    name: "truenas-iscsi",
  },
  provisioner: "csi.truenas.io",
  parameters: {
    protocol: "iscsi",
    compression: "LZ4",
    volblocksize: "16K",
    "iscsi.blocksize": "4096",
  },
  reclaimPolicy: "Retain",
  volumeBindingMode: "Immediate",
  allowVolumeExpansion: true,
};

const config: StaticApp = {
  kind: "static",
  name: "truenas-csi",
  resources: [...deployResources, storageClass],
};

export default config;
