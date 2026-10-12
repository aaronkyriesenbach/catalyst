import type { ProjectSpec } from "./types";

export const DOCKER_MIRROR_HOST = "docker.int.lab53.net";

export enum Project {
	SYSTEM = "system",
}

// `default` is created by ArgoCD's controller and must not be generated here.
export const projectDefinitions: Record<Project, ProjectSpec> = {
	[Project.SYSTEM]: {
		description: "Cluster infrastructure components",
		sourceRepos: ["*"],
		destinations: [
			{ server: "https://kubernetes.default.svc", namespace: "*" },
		],
		clusterResourceWhitelist: [{ group: "*", kind: "*" }],
	},
};

// Namespaces of releases adopted from live installs; moving an app would
// otherwise silently reinstall the chart elsewhere.
export const helmReleaseNamespaces: Record<string, string> = {
	reloader: "reloader",
	volsync: "volsync-system",
	"external-dns-int": "external-dns",
	"external-dns-ext": "external-dns",
	"cert-manager": "cert-manager",
	"trust-manager": "cert-manager",
	"external-secrets": "external-secrets",
	immich: "immich",
	"pocket-id-operator": "pocket-id",
};
