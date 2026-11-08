import { Project } from "@catalyst/core/constants";
import type { StaticApp } from "@catalyst/core/types";

const VERSION = "v8.6.0";
const BASE = `https://raw.githubusercontent.com/kubernetes-csi/external-snapshotter/${VERSION}`;

const config: StaticApp = {
  kind: "static",
  status: {
    exempt: "Controller with no endpoint; VictoriaMetrics alerts cover it",
  },
  name: "snapshot-controller",
  namespace: "kube-system",
  project: Project.SYSTEM,
  remoteResources: [
    `${BASE}/deploy/kubernetes/snapshot-controller/rbac-snapshot-controller.yaml`,
    `${BASE}/deploy/kubernetes/snapshot-controller/setup-snapshot-controller.yaml`,
    `${BASE}/client/config/crd/snapshot.storage.k8s.io_volumesnapshotclasses.yaml`,
    `${BASE}/client/config/crd/snapshot.storage.k8s.io_volumesnapshots.yaml`,
    `${BASE}/client/config/crd/snapshot.storage.k8s.io_volumesnapshotcontents.yaml`,
  ],
};

export default config;
