import { Project } from "../constants";
import type { ResourceLike, StaticApp } from "../types";
import { certManagerNamespace } from "./cert-manager";

const internalRootCaBundle: ResourceLike = {
	apiVersion: "trust.cert-manager.io/v1alpha1",
	kind: "Bundle",
	metadata: {
		name: "internal-root-ca-bundle",
	},
	spec: {
		sources: [
			{
				secret: {
					name: "internal-root-ca",
					key: "ca.crt",
				},
			},
		],
		target: {
			configMap: {
				key: "ca.crt",
			},
			namespaceSelector: {
				matchExpressions: [
					{
						key: "kubernetes.io/metadata.name",
						operator: "In",
						values: ["traefik", "stalwart"],
					},
				],
			},
		},
	},
};

const config: StaticApp = {
	kind: "static",
	name: "trust-manager",
	namespace: certManagerNamespace,
	project: Project.SYSTEM,
	resources: [internalRootCaBundle],
	helmReleases: [{ chart: "trustManager", releaseName: "trust-manager" }],
};

export default config;
