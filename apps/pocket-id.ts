import { buildBackupResources } from "../backup";
import type { StaticApp } from "../types";
import { readYaml } from "../utils";

const config: StaticApp = {
	kind: "static",
	name: "pocket-id",
	resources: buildBackupResources("pocket-id", "pocket-id-data"),
	helmReleases: [
		{
			chart: "pocketIdOperator",
			releaseName: "pocket-id-operator",
			values: await readYaml("./pocket-id/values.yaml", import.meta.url),
		},
	],
};

export default config;
