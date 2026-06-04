import { StorageClass } from "kubernetes-models/storage.k8s.io/v1";
import { parseAllDocuments } from "yaml";
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

const SNAPSHOT_CRD_BASE =
  "https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/v8.2.0/client/config/crd";

const config: StaticApp = {
  kind: "static",
  name: "truenas-csi",
  resources: [...deployResources, storageClass, volumeSnapshotClass],
  remoteResources: [
    `${SNAPSHOT_CRD_BASE}/snapshot.storage.k8s.io_volumesnapshotclasses.yaml`,
    `${SNAPSHOT_CRD_BASE}/snapshot.storage.k8s.io_volumesnapshots.yaml`,
    `${SNAPSHOT_CRD_BASE}/snapshot.storage.k8s.io_volumesnapshotcontents.yaml`,
  ],
};

export default config;
