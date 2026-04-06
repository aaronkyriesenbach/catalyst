import { IPodSpec } from "kubernetes-models/v1";
import { Model } from "@kubernetes-models/base";

export type AppConfig = {
  name: string;
  namespace?: string;
  podSpec?: IPodSpec;
  webPort?: number;
  extraResources?: (Model<unknown> | Object)[];
};

export type HelmChart = {
  apiVersion: "helm.cattle.io/v1";
  kind: "HelmChart";
  metadata: {
    name: string;
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
