import { Project } from "../constants";
import type { StaticApp } from "../types";

const VERSION = "v1.6.3";

const config: StaticApp = {
  kind: "static",
  name: "gateway-api",
  namespace: "kube-system",
  project: Project.SYSTEM,
  serverSideApply: true,
  remoteResources: [
    `https://github.com/kubernetes-sigs/gateway-api/releases/download/${VERSION}/standard-install.yaml`,
  ],
  remoteResourceAnnotations: {
    "argocd.argoproj.io/sync-options": "Prune=false,Delete=false",
  },
};

export default config;
