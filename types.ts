import { Model } from "@kubernetes-models/base";
import { IPodSpec } from "kubernetes-models/v1";

export type ResourceLike =
  | Model<unknown>
  | { toJSON(): unknown }
  | Record<string, unknown>;

/** Kubernetes binary storage quantity, e.g. "10Gi", "1Ti". */
export type StorageQuantity = `${number}${"Ki" | "Mi" | "Gi" | "Ti" | "Pi"}`;

type BaseApp = {
  name: string;
  namespace?: string;
  project?: Project;
};

export type WorkloadApp = BaseApp & {
  kind: "workload";
  podSpec: IPodSpec;
  webPort?: number;
  subDomain?: string;
  externallyAccessible?: boolean;
  forwardAuth?: boolean;
  extraResources?: ResourceLike[];
  strategy?: { type: "Recreate" | "RollingUpdate" };
};

export type StaticApp = BaseApp & {
  kind: "static";
  resources?: ResourceLike[];
  remoteResources?: string[];
};

export type AppConfig = WorkloadApp | StaticApp;

export type HelmChart = {
  apiVersion: "helm.cattle.io/v1";
  kind: "HelmChart";
  metadata: {
    name: string;
    namespace?: string;
  };
  spec: {
    repo?: string;
    chart: string;
    targetNamespace?: string;
    version: string;
    valuesContent?: string;
    set?: { [key: string]: string };
  };
};

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

export type BackendTLSPolicy = {
  apiVersion: "gateway.networking.k8s.io/v1";
  kind: "BackendTLSPolicy";
  metadata: {
    name: string;
  };
  spec: {
    targetRefs: Array<{
      name: string;
      group: string;
      kind: string;
      sectionName?: string;
    }>;
    validation: {
      hostname: string;
      caCertificateRefs?: Array<{
        group: string;
        kind: string;
        name: string;
      }>;
    };
  };
};
