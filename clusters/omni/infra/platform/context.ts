import * as pulumi from "@pulumi/pulumi";
import { kubernetesProvider } from "@catalyst/infra/kubeconfig";

export const config = new pulumi.Config();

export const provider = kubernetesProvider(
  "omni",
  config.require("clusterStack"),
);

export const opts = { provider };
