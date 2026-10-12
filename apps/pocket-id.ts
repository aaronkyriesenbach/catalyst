import { buildBackupResources } from "../backup";
import type { StaticApp } from "../types";
import { readFile, buildHelmChart } from "../utils";

const chart = buildHelmChart("pocketIdOperator", {
	name: "pocket-id-operator",
	targetNamespace: "pocket-id",
	valuesContent: await readFile("./pocket-id/values.yaml", import.meta.url),
});

const config: StaticApp = {
	kind: "static",
	name: "pocket-id",
	resources: [chart, ...buildBackupResources("pocket-id", "pocket-id-data")],
};

export default config;
