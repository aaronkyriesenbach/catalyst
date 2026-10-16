import type {
  IAppProject,
  IApplication,
} from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
import { Model } from "@kubernetes-models/base";
import type { IDeploymentStrategy } from "kubernetes-models/apps/v1";
import { IPodSpec } from "kubernetes-models/v1";
import type { Project } from "./constants";
import type { HelmChartKey } from "./versions";
import type { WafSetting } from "./waf";

export type WorkloadStrategy = Pick<IDeploymentStrategy, "type">;

export type ProjectSpec = IAppProject["spec"];

export type ResourceLike =
  Model<unknown> | { toJSON(): unknown } | Record<string, unknown>;

/** Kubernetes binary storage quantity, e.g. "10Gi", "1Ti". */
export type StorageQuantity = `${number}${"Ki" | "Mi" | "Gi" | "Ti" | "Pi"}`;

export type HelmRelease = {
  chart: HelmChartKey;
  /** Must equal the existing helm release name when adopting a live install. */
  releaseName: string;
  values?: Record<string, unknown>;
  /** Passed to Helm as `--set`. */
  parameters?: Record<string, string>;
  /** Set on all but one release when several releases of a chart share a namespace, so a `crds/` directory is not rendered twice. */
  skipCrds?: boolean;
};

type BaseApp = {
  name: string;
  namespace?: string;
  project?: Project;
  /** Charts are installed into the app's destination namespace. */
  helmReleases?: HelmRelease[];
  /** For fields written at runtime (e.g. webhook `caBundle`). */
  ignoreDifferences?: IApplication["spec"]["ignoreDifferences"];
  /** Set to `false` for apps that should only sync when triggered by hand. Defaults to `true`. */
  autoSync?: boolean;
};

export type WorkloadApp = BaseApp & {
  kind: "workload";
  podSpec: IPodSpec;
  webPort?: number;
  subDomain?: string;
  externallyAccessible?: boolean;
  forwardAuth?: boolean;
  /** Externally accessible apps get the WAF by default; set this to pick a profile or exempt the app. */
  waf?: WafSetting;
  extraResources?: ResourceLike[];
  strategy?: WorkloadStrategy;
  /** Seconds a rollout may go without progress before Argo reports it Degraded. */
  progressDeadlineSeconds?: number;
  /** Why no container has a readiness probe; required when none does. */
  probeExempt?: string;
};

export type StaticApp = BaseApp & {
  kind: "static";
  resources?: ResourceLike[];
  remoteResources?: string[];
};

export type AppConfig = WorkloadApp | StaticApp;

export type CertDeployStrategy =
  | { type: "proxmox"; nodes: { name: string; ipAddress: string }[] }
  | { type: "truenas"; importedNamePrefix?: string }
  | { type: "unifi-local-api" };

export type ExternalApp = {
  name: string;
  ipAddress: string;
  port: number;
  subDomain?: string;
  insecure?: boolean;
  certDeploy?: CertDeployStrategy;
};
