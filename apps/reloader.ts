import { Project } from "../constants";
import type { StaticApp } from "../types";
import { buildHelmChart } from "../utils";

const chart = buildHelmChart("reloader", {
	name: "reloader",
	targetNamespace: "reloader",
});

const config: StaticApp = {
	kind: "static",
	name: "reloader",
	project: Project.SYSTEM,
	resources: [chart],
};

export default config;
