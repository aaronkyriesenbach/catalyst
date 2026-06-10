import type { ProjectSpec } from "./types";

export enum Project {
  SYSTEM = "system",
}

// `default` is created by ArgoCD's controller and must not be generated here.
export const projectDefinitions: Record<Project, ProjectSpec> = {
  [Project.SYSTEM]: {
    description: "Cluster infrastructure components",
    sourceRepos: ["*"],
    destinations: [{ server: "https://kubernetes.default.svc", namespace: "*" }],
    clusterResourceWhitelist: [{ group: "*", kind: "*" }],
  },
};
