import { Project } from "../constants";
import type { ResourceLike, StaticApp } from "../types";
import { certManagerNamespace } from "./cert-manager";
import { buildHelmChart } from "../utils";

const chart = buildHelmChart("trustManager", {
	name: "trust-manager",
	targetNamespace: certManagerNamespace,
});

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
	resources: [chart, internalRootCaBundle],
};

export default config;
