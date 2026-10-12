import { helmCharts, images, postgresImages } from "../versions";

type Datasource = "docker" | "helm";

type Match = {
	datasource: Datasource;
	depName: string;
	currentValue: string;
};

type Check = {
	label: string;
	datasource: Datasource;
	pattern: RegExp;
	expected: number;
};

const source = await Bun.file(
	new URL("../versions.ts", import.meta.url),
).text();

const helmEntries = Object.values(helmCharts);

// Keep in sync with the Renovate regex managers that parse versions.ts.
const checks: Check[] = [
	{
		label: "images",
		datasource: "docker",
		pattern:
			/name:\s*"(?<depName>[^"]+)",\s*tag:\s*"(?<currentValue>[^"]+)"/g,
		expected:
			Object.keys(images).length + Object.keys(postgresImages).length,
	},
	{
		label: "repo charts",
		datasource: "helm",
		pattern:
			/kind:\s*"repo",\s*repo:\s*"(?<registryUrl>[^"]+)",\s*chart:\s*"(?<depName>[^"]+)",\s*version:\s*"(?<currentValue>[^"]+)"/g,
		expected: helmEntries.filter((entry) => entry.kind === "repo").length,
	},
	{
		label: "oci charts",
		datasource: "docker",
		pattern:
			/kind:\s*"oci",\s*chart:\s*"oci:\/\/(?<depName>[^"]+)",\s*version:\s*"(?<currentValue>[^"]+)"/g,
		expected: helmEntries.filter((entry) => entry.kind === "oci").length,
	},
];

let failed = false;

for (const check of checks) {
	const matches: Match[] = [];

	for (const found of source.matchAll(check.pattern)) {
		const { depName, currentValue } = found.groups ?? {};

		if (depName === undefined || currentValue === undefined) {
			continue;
		}

		matches.push({ datasource: check.datasource, depName, currentValue });
	}

	for (const match of matches) {
		console.log(
			`${match.datasource} ${match.depName} ${match.currentValue}`,
		);
	}

	if (matches.length !== check.expected) {
		failed = true;
		console.error(
			`${check.label}: matched ${matches.length} entries, expected ${check.expected}`,
		);
	}
}

if (failed) {
	process.exit(1);
}
