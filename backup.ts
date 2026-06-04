import { ExternalSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { clusterGeneratorRef } from "./apps/external-secrets";
import type { ResourceLike } from "./types";

const RESTIC_SERVER_URL = "rest:http://restic-server.restic-server:8000";
const VOLSYNC_API_VERSION = "volsync.backube/v1alpha1";
const DEFAULT_SNAPSHOT_CLASS = "truenas-iscsi";
const DEFAULT_STORAGE_CLASS = "truenas-iscsi";
const DEFAULT_SCHEDULE = "0 3 * * *";
const DEFAULT_PRUNE_INTERVAL_DAYS = 14;

const DEFAULT_RETAIN = {
  daily: 7,
  weekly: 4,
  monthly: 2,
};

export type BackupOptions = {
  schedule?: string;
  runAsUser?: number;
  runAsGroup?: number;
  fsGroup?: number;
  retain?: {
    daily?: number;
    weekly?: number;
    monthly?: number;
  };
};

function buildResticConfigSecret(
  appName: string,
  pvcName: string,
): ExternalSecret {
  const secretName = `${pvcName}-restic-config`;
  const repoUrl = `${RESTIC_SERVER_URL}/${appName}/${pvcName}`;

  return new ExternalSecret({
    metadata: { name: secretName },
    spec: {
      refreshInterval: "0",
      target: {
        name: secretName,
        template: {
          data: {
            RESTIC_REPOSITORY: repoUrl,
            RESTIC_PASSWORD: "{{ .password }}",
          },
        },
      },
      dataFrom: [
        {
          sourceRef: {
            generatorRef: clusterGeneratorRef,
          },
        },
      ],
    },
  });
}

function buildReplicationSource(
  pvcName: string,
  options?: BackupOptions,
): ResourceLike {
  const secretName = `${pvcName}-restic-config`;
  const retain = { ...DEFAULT_RETAIN, ...options?.retain };
  const runAsUser = options?.runAsUser ?? 1000;
  const runAsGroup = options?.runAsGroup ?? 1000;
  const fsGroup = options?.fsGroup ?? 1000;

  return {
    apiVersion: VOLSYNC_API_VERSION,
    kind: "ReplicationSource",
    metadata: { name: `${pvcName}-backup` },
    spec: {
      sourcePVC: pvcName,
      trigger: {
        schedule: options?.schedule ?? DEFAULT_SCHEDULE,
      },
      restic: {
        copyMethod: "Snapshot",
        storageClassName: DEFAULT_STORAGE_CLASS,
        volumeSnapshotClassName: DEFAULT_SNAPSHOT_CLASS,
        repository: secretName,
        pruneIntervalDays: DEFAULT_PRUNE_INTERVAL_DAYS,
        retain,
        moverSecurityContext: {
          runAsUser,
          runAsGroup,
          fsGroup,
        },
      },
    },
  };
}

export function buildBackupResources(
  appName: string,
  pvcName: string,
  options?: BackupOptions,
): ResourceLike[] {
  return [
    buildResticConfigSecret(appName, pvcName),
    buildReplicationSource(pvcName, options),
  ];
}
