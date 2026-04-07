import { IPodSpec } from "kubernetes-models/v1";
import { Model } from "@kubernetes-models/base";

export type ResourceLike = Model<unknown> | Record<string, unknown>;

type BaseApp = {
  name: string;
  namespace?: string;
};

export type WorkloadApp = BaseApp & {
  kind: "workload";
  podSpec: IPodSpec;
  webPort?: number;
  subDomain?: string;
  externallyAccessible?: boolean;
  extraResources?: ResourceLike[];
};

export type StaticApp = BaseApp & {
  kind: "static";
  resources: ResourceLike[];
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

export type ExternalApp = {
  name: string;
  ipAddress: string;
  port: number;
  subDomain?: string;
  insecure?: boolean;
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
