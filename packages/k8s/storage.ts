import {
  PersistentVolume,
  PersistentVolumeClaim,
  type IPersistentVolumeClaimSpec,
  type IPersistentVolumeClaimTemplate,
  type IPersistentVolumeSpec,
} from "kubernetes-models/v1";
import type { StorageQuantity } from "@catalyst/core/types";

const DEFAULT_NAS_IP = "192.168.53.120";
const DEFAULT_NAS_PATH = "/mnt/tank/data";
const DEFAULT_RECLAIM_POLICY = "Retain";
const DEFAULT_ACCESS_MODES = ["ReadWriteMany"] as const;

type PersistentVolumeReclaimPolicy = NonNullable<
  IPersistentVolumeSpec["persistentVolumeReclaimPolicy"]
>;

type BuildPersistentVolumeOptions = {
  name: string;
  storage: StorageQuantity;
  storageClassName: string;
  accessModes: PersistentVolumeAccessMode[];
  reclaimPolicy?: PersistentVolumeReclaimPolicy;
  nfsServer?: string;
  nfsPath?: string;
};

type BuildPersistentVolumeClaimOptions = {
  name: string;
  storage: StorageQuantity;
  storageClassName: string;
  accessModes: PersistentVolumeAccessMode[];
  volumeName: string;
};

type BuildNasPersistentVolumePairOptions = {
  name: string;
  storage: StorageQuantity;
  storageClassName?: string;
  accessModes?: PersistentVolumeAccessMode[];
  reclaimPolicy?: PersistentVolumeReclaimPolicy;
  nfsServer?: string;
  nfsPath?: string;
};

export function buildPersistentVolume(options: BuildPersistentVolumeOptions) {
  const {
    name,
    storage,
    storageClassName,
    accessModes,
    reclaimPolicy = DEFAULT_RECLAIM_POLICY,
    nfsServer = DEFAULT_NAS_IP,
    nfsPath = DEFAULT_NAS_PATH,
  } = options;

  return new PersistentVolume({
    metadata: {
      name,
    },
    spec: {
      capacity: {
        storage,
      },
      accessModes,
      persistentVolumeReclaimPolicy: reclaimPolicy,
      storageClassName,
      nfs: {
        server: nfsServer,
        path: nfsPath,
      },
    },
  });
}

export function buildPersistentVolumeClaim(
  options: BuildPersistentVolumeClaimOptions,
) {
  const { name, storage, storageClassName, accessModes, volumeName } = options;

  return new PersistentVolumeClaim({
    metadata: { name },
    spec: buildPvcSpec({
      storage,
      storageClassName,
      accessModes,
      volumeName,
    }),
  });
}

export function buildNasPersistentVolumePair(
  options: BuildNasPersistentVolumePairOptions,
) {
  const {
    name,
    storage,
    storageClassName = name,
    accessModes = [...DEFAULT_ACCESS_MODES],
    nfsServer,
    nfsPath,
    reclaimPolicy,
  } = options;

  return {
    pv: buildPersistentVolume({
      name,
      storage,
      storageClassName,
      accessModes,
      nfsServer,
      nfsPath,
      reclaimPolicy,
    }),
    pvc: buildPersistentVolumeClaim({
      name,
      storage,
      storageClassName,
      accessModes,
      volumeName: name,
    }),
  };
}

const DEFAULT_ISCSI_STORAGE = "10Gi";
const DEFAULT_ISCSI_STORAGE_CLASS = "truenas-iscsi";

export type PersistentVolumeAccessMode = NonNullable<
  IPersistentVolumeClaimSpec["accessModes"]
>[number];

export function buildPvcSpec(opts: {
  storage: StorageQuantity;
  storageClassName: string;
  accessModes: PersistentVolumeAccessMode[];
  volumeName?: string;
}): IPersistentVolumeClaimSpec {
  return {
    accessModes: opts.accessModes,
    storageClassName: opts.storageClassName,
    resources: { requests: { storage: opts.storage } },
    ...(opts.volumeName ? { volumeName: opts.volumeName } : {}),
  };
}

export function buildIscsiPvcTemplate(
  name: string,
  storageRequest?: StorageQuantity,
): IPersistentVolumeClaimTemplate {
  return {
    metadata: { name },
    spec: buildPvcSpec({
      storage: storageRequest ?? DEFAULT_ISCSI_STORAGE,
      storageClassName: DEFAULT_ISCSI_STORAGE_CLASS,
      accessModes: ["ReadWriteOnce"],
    }),
  };
}

export function buildIscsiPvc(name: string, storageRequest?: StorageQuantity) {
  return new PersistentVolumeClaim(buildIscsiPvcTemplate(name, storageRequest));
}
