import { StorageClass } from "kubernetes-models/storage.k8s.io/v1";
import { parseAllDocuments } from "yaml";
import { Project } from "../constants";
import type { ResourceLike, StaticApp } from "../types";
import { readFile } from "../utils";

const deployYaml = await readFile("./truenas-csi/deploy.yaml", import.meta.url);

const deployResources = parseAllDocuments(deployYaml)
  .map((doc) => doc.toJSON() as ResourceLike)
  .filter(Boolean);

const storageClass: StorageClass = new StorageClass({
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
  reclaimPolicy: "Delete",
  volumeBindingMode: "Immediate",
  allowVolumeExpansion: true,
});

const volumeSnapshotClass: ResourceLike = {
  apiVersion: "snapshot.storage.k8s.io/v1",
  kind: "VolumeSnapshotClass",
  metadata: {
    name: "truenas-iscsi",
  },
  driver: "csi.truenas.io",
  deletionPolicy: "Delete",
};

const config: StaticApp = {
  kind: "static",
  name: "truenas-csi",
  project: Project.SYSTEM,
  resources: [...deployResources, storageClass, volumeSnapshotClass],
};

export default config;
