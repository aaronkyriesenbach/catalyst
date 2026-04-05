import { IPodSpec, PodSpec } from "kubernetes-models/v1";

export type AppConfig = {
  name: string;
  namespace?: string;
  podSpec: IPodSpec;
  webPort?: number;
};
