import { helmCharts, images, postgresImages } from "../versions";

type Datasource = "docker" | "helm";

type CustomManager = {
	managerFilePatterns: string[];
	matchStrings: string[];
	datasourceTemplate: string;
	depTypeTemplate: string;
};

type Check = {
	label: string;
	datasource: Datasource;
	depType: string;
	expected: number;
};

type Span = { start: number; end: number; label: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isCustomManager(value: unknown): value is CustomManager {
	return (
		isRecord(value) &&
		isStringArray(value.managerFilePatterns) &&
		isStringArray(value.matchStrings) &&
		typeof value.datasourceTemplate === "string" &&
		typeof value.depTypeTemplate === "string"
	);
}

async function loadManagers(): Promise<CustomManager[]> {
	const config: unknown = await Bun.file(
		new URL("../renovate.json", import.meta.url),
	).json();

	if (!isRecord(config) || !Array.isArray(config.customManagers)) {
		throw new Error("renovate.json has no customManagers array");
	}

	return config.customManagers.filter(isCustomManager);
}

const versionsPattern = "/^versions\\.ts$/";

const source = await Bun.file(
	new URL("../versions.ts", import.meta.url),
).text();

const managers = (await loadManagers()).filter((manager) =>
	manager.managerFilePatterns.includes(versionsPattern),
);

const helmEntries = Object.values(helmCharts);

const checks: Check[] = [
	{
		label: "images",
		datasource: "docker",
		depType: "image",
		expected:
			Object.keys(images).length + Object.keys(postgresImages).length,
	},
	{
		label: "repo charts",
		datasource: "helm",
		depType: "helm-chart",
		expected: helmEntries.filter((entry) => entry.kind === "repo").length,
	},
	{
		label: "oci charts",
		datasource: "docker",
		depType: "helm-chart",
		expected: helmEntries.filter((entry) => entry.kind === "oci").length,
	},
];

let failed = false;
const spans: Span[] = [];

for (const check of checks) {
	const candidates = managers.filter(
		(manager) =>
			manager.datasourceTemplate === check.datasource &&
			manager.depTypeTemplate === check.depType,
	);

	if (candidates.length !== 1) {
		failed = true;
		console.error(
			`${check.label}: expected exactly one ${check.datasource}/${check.depType} manager in renovate.json, found ${candidates.length}`,
		);
		continue;
	}

	let count = 0;

	for (const matchString of candidates[0]?.matchStrings ?? []) {
		for (const found of source.matchAll(new RegExp(matchString, "g"))) {
			const { depName, currentValue } = found.groups ?? {};

			if (depName === undefined || currentValue === undefined) {
				continue;
			}

			count += 1;
			console.log(`${check.datasource} ${depName} ${currentValue}`);
		}
	}

	if (count !== check.expected) {
		failed = true;
		console.error(
			`${check.label}: matched ${count} entries, expected ${check.expected}`,
		);
	}
}

for (const manager of managers) {
	for (const matchString of manager.matchStrings) {
		for (const found of source.matchAll(new RegExp(matchString, "g"))) {
			spans.push({
				start: found.index,
				end: found.index + found[0].length,
				label: found[0].replace(/\s+/g, " "),
			});
		}
	}
}

spans.sort((a, b) => a.start - b.start);

for (const [index, span] of spans.entries()) {
	const next = spans[index + 1];

	if (next && next.start < span.end) {
		failed = true;
		console.error(
			`matched by more than one manager: ${span.label} / ${next.label}`,
		);
	}
}

if (failed) {
	process.exit(1);
}
