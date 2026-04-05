import { IPodSpec } from "kubernetes-models/v1";
import { Model } from "@kubernetes-models/base";

export type AppConfig = {
  name: string;
  namespace?: string;
  podSpec?: IPodSpec;
  webPort?: number;
  extraResources?: (Model<unknown> | Object)[];
};
