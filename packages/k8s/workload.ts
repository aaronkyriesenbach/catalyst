import { Deployment, StatefulSet } from "kubernetes-models/apps/v1";
import {
  ConfigMap,
  Service,
  type IPersistentVolumeClaimTemplate,
  type IPodSpec,
  type IServicePort,
} from "kubernetes-models/v1";
import type { WorkloadStrategy } from "@catalyst/core/types";
import { assertReadinessProbe } from "./probes";

// minReadySeconds keeps a pod that passes its probe once and then crashes from
// counting as Available, so the old pod isn't removed on a false positive.
const DEFAULT_MIN_READY_SECONDS = 15;
const DEFAULT_PROGRESS_DEADLINE_SECONDS = 300;

type RolloutOptions = {
  /** Reason this pod can't be probed; skips the readiness probe requirement. */
  probeExempt?: string;
};

type DeploymentOptions = RolloutOptions & {
  replicas?: number;
  revisionHistoryLimit?: number;
  strategy?: WorkloadStrategy;
  progressDeadlineSeconds?: number;
};

function buildStrategy(type: WorkloadStrategy["type"] = "RollingUpdate") {
  return type === "Recreate"
    ? { type }
    : { type, rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } };
}

export function buildDeployment(
  name: string,
  podSpec: IPodSpec,
  options?: DeploymentOptions,
) {
  assertReadinessProbe(name, podSpec, options?.probeExempt);

  return new Deployment({
    metadata: {
      name,
      labels: { app: name },
      annotations: { "reloader.stakater.com/auto": "true" },
    },
    spec: {
      replicas: options?.replicas ?? 1,
      revisionHistoryLimit: options?.revisionHistoryLimit ?? 2,
      strategy: buildStrategy(options?.strategy?.type),
      minReadySeconds: DEFAULT_MIN_READY_SECONDS,
      progressDeadlineSeconds:
        options?.progressDeadlineSeconds ?? DEFAULT_PROGRESS_DEADLINE_SECONDS,
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: podSpec,
      },
    },
  });
}

export function buildService(name: string, ports: IServicePort[]) {
  return new Service({
    metadata: { name },
    spec: {
      selector: { app: name },
      ports,
    },
  });
}

export function buildHeadlessService(name: string, ports: IServicePort[]) {
  return new Service({
    metadata: { name },
    spec: {
      clusterIP: "None",
      selector: { app: name },
      ports,
    },
  });
}

export function buildFileConfigMap(
  name: string,
  files: Record<string, string>,
): ConfigMap {
  return new ConfigMap({
    metadata: { name },
    data: files,
  });
}

type StatefulSetOptions = RolloutOptions & {
  replicas?: number;
  revisionHistoryLimit?: number;
};

export function buildStatefulSet(
  name: string,
  podSpec: IPodSpec,
  volumeClaimTemplates: IPersistentVolumeClaimTemplate[],
  options?: StatefulSetOptions,
) {
  assertReadinessProbe(name, podSpec, options?.probeExempt);

  return new StatefulSet({
    metadata: {
      name,
      labels: { app: name },
    },
    spec: {
      serviceName: name,
      replicas: options?.replicas ?? 1,
      revisionHistoryLimit: options?.revisionHistoryLimit ?? 2,
      minReadySeconds: DEFAULT_MIN_READY_SECONDS,
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: podSpec,
      },
      volumeClaimTemplates,
    },
  });
}
