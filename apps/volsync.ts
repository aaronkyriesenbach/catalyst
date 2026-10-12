import { Project } from "../constants";
import type { StaticApp } from "../types";
import { buildHelmChart } from "../utils";

const chart = buildHelmChart("volsync", {
	name: "volsync",
	targetNamespace: "volsync-system",
});

const config: StaticApp = {
	kind: "static",
	name: "volsync",
	namespace: "volsync-system",
	project: Project.SYSTEM,
	resources: [chart],
};

export default config;
