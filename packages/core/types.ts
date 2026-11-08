import type {
  IAppProject,
  IApplication,
} from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
import { Model } from "@kubernetes-models/base";
import type { IDeploymentStrategy } from "kubernetes-models/apps/v1";
import { IPodSpec } from "kubernetes-models/v1";
import type { Project } from "./constants";
import type { HelmChartKey } from "@catalyst/versions/versions";
import type { StatusDeclaration } from "@catalyst/platform/status";
import type { WafSetting } from "@catalyst/platform/waf";

export type WorkloadStrategy = Pick<IDeploymentStrategy, "type">;

export type ProjectSpec = IAppProject["spec"];

export type ResourceLike =
  Model<object> | { toJSON(): object } | Record<string, unknown>;

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

// `proxy` is forward auth through the embedded outpost (no shared secret).
type ProxyOidcDeclaration = {
  kind: "proxy";
  skipPathRegex?: readonly string[];
};

export type OAuth2OidcDeclaration = {
  kind: "oauth2";
  redirectPaths: readonly `/${string}`[];
  rotate: string | false;
};

export type PublicOidcDeclaration = {
  kind: "oauth2-public";
  redirectPaths: readonly `/${string}`[];
};

export type OidcDeclaration =
  ProxyOidcDeclaration | OAuth2OidcDeclaration | PublicOidcDeclaration;

/** One more authentik application for an app that serves several hostnames (e.g. a media stack). */
export type AdditionalOidcApp = {
  /** Names the authentik group and application, so it must be unique across apps. */
  name: string;
  /** Hostname label; defaults to `name`. */
  subDomain?: string;
  externallyAccessible?: boolean;
  oidc: OidcDeclaration;
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
  /** Apply with ServerSideApply, required for resources too large for the last-applied annotation (CRDs). Helm apps always use it. */
  serverSideApply?: boolean;
  /** Hostname label; defaults to `name`. Used for the OIDC client's URL. */
  subDomain?: string;
  /** Declares the authentik group, provider and application for this app. */
  oidc?: OidcDeclaration;
  /** Registered next to `oidc`, in the app's namespace. The app builds the routes and Middleware itself. */
  additionalOidc?: readonly AdditionalOidcApp[];
  status?: StatusDeclaration;
};

export type WorkloadApp = BaseApp & {
  kind: "workload";
  podSpec: IPodSpec;
  webPort?: number;
  externallyAccessible?: boolean;
  /** Externally accessible apps get the WAF by default; set this to pick a profile or exempt the app. */
  waf?: WafSetting;
  extraResources?: ResourceLike[];
  derive?: (context: DeriveContext) => WorkloadDerived;
  strategy?: WorkloadStrategy;
  /** Seconds a rollout may go without progress before Argo reports it Degraded. */
  progressDeadlineSeconds?: number;
  /** Why no container has a readiness probe; required when none does. */
  probeExempt?: string;
};

export type StaticApp = BaseApp & {
  kind: "static";
  subDomain?: string;
  externallyAccessible?: boolean;
  /** Forward auth needs a route the app builder owns, so a StaticApp can only be an OIDC client. */
  oidc?: OAuth2OidcDeclaration;
  resources?: ResourceLike[];
  derive?: (context: DeriveContext) => StaticDerived;
  remoteResources?: string[];
  /** Merged into the metadata annotations of every remote resource. */
  remoteResourceAnnotations?: Record<string, string>;
};

export type AppConfig = WorkloadApp | StaticApp;

export type CatalogEntry = {
  cluster: string;
  config: AppConfig;
};

export type Catalog = {
  readonly entries: readonly CatalogEntry[];
  onCluster(cluster: string): AppConfig[];
};

export type DeriveContext = { catalog: Catalog; cluster: Cluster };

export type UnmirroredChartImage = {
  release: string;
  repository: string;
  reason: string;
};

export type Cluster = {
  name: string;
  kind: "standalone";
  network: {
    podCidr: string;
    serviceCidr: string;
    vips: { api: string; gateway: string };
  };
  edge: { cloudflareTunnelId: string };
  gitops: {
    projects: Record<Project, ProjectSpec>;
    unmanagedNamespaces: readonly string[];
    unmirroredChartImages: readonly UnmirroredChartImage[];
  };
};

export type ClusterDefinition = Omit<Cluster, "name">;

type DerivedHelm = { helmReleases?: HelmRelease[] };

export type StaticDerived = DerivedHelm & { resources?: ResourceLike[] };

export type WorkloadDerived = DerivedHelm & { extraResources?: ResourceLike[] };

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
