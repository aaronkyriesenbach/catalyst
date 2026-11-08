import { ExternalSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { clusterGeneratorRef } from "./external-secrets";
import { cron, type CronExpression } from "./cron";
import type { ResourceLike } from "@catalyst/core/types";
import { AWS_STORE, buildSeedPushSecret, generatedRemoteKey } from "./secrets";

const RESTIC_SERVER_URL = "rest:http://restic-server.restic-server:8000";
const VOLSYNC_API_VERSION = "volsync.backube/v1alpha1";
const DEFAULT_SNAPSHOT_CLASS = "truenas-iscsi";
const DEFAULT_STORAGE_CLASS = "truenas-iscsi";
// UTC (VolSync cron): 05:00-10:00 is 00:00-05:00 EST, 01:00-06:00 in EDT.
const BACKUP_WINDOW_START_HOUR = 5;
const BACKUP_WINDOW_MINUTES = 300;
const DEFAULT_PRUNE_INTERVAL_DAYS = 14;

const DEFAULT_RETAIN = {
  daily: 7,
  weekly: 4,
  monthly: 2,
};

// FNV-1a: stable across runs, so a PVC keeps its slot between renders.
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// Stagger backups within the window to keep load on TrueNAS low
export function staggeredBackupSchedule(
  namespace: string,
  pvcName: string,
): CronExpression {
  const offset = fnv1a([namespace, pvcName].join("/")) % BACKUP_WINDOW_MINUTES;
  return cron({
    minute: offset % 60,
    hour: BACKUP_WINDOW_START_HOUR + Math.floor(offset / 60),
  });
}

export type BackupOptions = {
  schedule?: CronExpression;
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
  namespace: string,
  pvcName: string,
): ResourceLike[] {
  const secretName = `${pvcName}-restic-config`;
  const remoteKey = generatedRemoteKey(namespace, secretName);
  const repoUrl = `${RESTIC_SERVER_URL}/${namespace}/${pvcName}`;

  return [
    buildSeedPushSecret(
      `${secretName}-seed`,
      remoteKey,
      "RESTIC_PASSWORD",
      clusterGeneratorRef,
    ),
    new ExternalSecret({
      metadata: { name: secretName },
      spec: {
        refreshInterval: "1h",
        secretStoreRef: AWS_STORE,
        target: {
          name: secretName,
          template: {
            data: {
              RESTIC_REPOSITORY: repoUrl,
              RESTIC_PASSWORD: "{{ .password }}",
            },
          },
        },
        data: [
          {
            secretKey: "password",
            remoteRef: {
              key: remoteKey,
              property: "RESTIC_PASSWORD",
            },
          },
        ],
      },
    }),
  ];
}

function buildReplicationSource(
  namespace: string,
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
        schedule:
          options?.schedule ?? staggeredBackupSchedule(namespace, pvcName),
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
  namespace: string,
  pvcName: string,
  options?: BackupOptions,
): ResourceLike[] {
  return [
    ...buildResticConfigSecret(namespace, pvcName),
    buildReplicationSource(namespace, pvcName, options),
  ];
}
