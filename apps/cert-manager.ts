import { Project } from "../constants";
import type { StaticApp } from "../types";
import { internalCaResources } from "./cert-manager/internal-ca";
import { issuers } from "./cert-manager/issuers";
import { buildHelmChart } from "../utils";

export const certManagerNamespace = "cert-manager";

const chart = buildHelmChart("certManager", {
	name: "cert-manager",
	targetNamespace: certManagerNamespace,
	set: {
		"crds.enabled": "true",
	},
});

const config: StaticApp = {
	kind: "static",
	name: "cert-manager",
	project: Project.SYSTEM,
	resources: [chart, ...issuers, ...internalCaResources],
};

export default config;
