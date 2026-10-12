import { Project } from "../constants";
import type { StaticApp } from "../types";
import { internalCaResources } from "./cert-manager/internal-ca";
import { issuers } from "./cert-manager/issuers";

export const certManagerNamespace = "cert-manager";

const config: StaticApp = {
	kind: "static",
	name: "cert-manager",
	project: Project.SYSTEM,
	resources: [...issuers, ...internalCaResources],
	helmReleases: [
		{
			chart: "certManager",
			releaseName: "cert-manager",
			parameters: { "crds.enabled": "true" },
		},
	],
};

export default config;
