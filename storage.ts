import { PersistentVolume, PersistentVolumeClaim } from "kubernetes-models/v1";

const DEFAULT_NAS_IP = "192.168.53.120";
const DEFAULT_NAS_PATH = "/mnt/tank/data";
const DEFAULT_RECLAIM_POLICY = "Retain";
const DEFAULT_ACCESS_MODES = ["ReadWriteMany"] as const;

type PersistentVolumeAccessMode =
  | "ReadOnlyMany"
  | "ReadWriteMany"
  | "ReadWriteOnce"
  | "ReadWriteOncePod";

type PersistentVolumeReclaimPolicy = "Retain" | "Delete" | "Recycle";

type BuildPersistentVolumeOptions = {
  name: string;
  storage: string;
  storageClassName: string;
  accessModes: PersistentVolumeAccessMode[];
  reclaimPolicy?: PersistentVolumeReclaimPolicy;
  nfsServer?: string;
  nfsPath?: string;
};

type BuildPersistentVolumeClaimOptions = {
  name: string;
  storage: string;
  storageClassName: string;
  accessModes: PersistentVolumeAccessMode[];
  volumeName: string;
};

type BuildNasPersistentVolumePairOptions = {
  name: string;
  storage: string;
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
    metadata: {
      name,
    },
    spec: {
      accessModes,
      resources: {
        requests: {
          storage,
        },
      },
      storageClassName,
      volumeName,
    },
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
