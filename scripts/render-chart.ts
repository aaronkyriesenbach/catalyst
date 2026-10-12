import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import { appNamespace, loadAppConfig } from "../utils";
import { helmCharts, type HelmChartEntry } from "../versions";
import type { HelmRelease } from "../types";

const usage = `Usage: bun run render-chart <app-name>

Runs \`helm template\` for each of the app's helmReleases and prints the
manifests. Requires the \`helm\` CLI (developer/CI tool only, not in the CMP).

This approximates what ArgoCD renders: hooks, kube versions and API versions
can differ. Use \`argocd app manifests <app>\` for the authoritative output.`;

const arg = process.argv[2];

if (!arg || arg === "--help" || arg === "-h") {
	console.error(usage);
	process.exit(arg ? 0 : 1);
}

function chartArgs(entry: HelmChartEntry): string[] {
	return entry.kind === "repo"
		? [entry.chart, "--repo", entry.repo]
		: [entry.chart];
}

async function templateRelease(
	release: HelmRelease,
	namespace: string,
	tempDir: string,
): Promise<string> {
	const entry: HelmChartEntry = helmCharts[release.chart];
	const valuesFile = join(tempDir, `-values.yaml`);

	writeFileSync(valuesFile, stringify(release.values ?? {}));

	const setArgs = Object.entries(release.parameters ?? {}).flatMap(
		([key, value]) => ["--set", `=`],
	);
	const proc = Bun.spawn(
		[
			"helm",
			"template",
			release.releaseName,
			...chartArgs(entry),
			"--version",
			entry.version,
			"--namespace",
			namespace,
			"--include-crds",
			"-f",
			valuesFile,
			...setArgs,
		],
		{ stdout: "pipe", stderr: "inherit" },
	);
	const [output, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		throw new Error(`helm template failed for `);
	}

	return output;
}

const name = arg.replace(/\.ts$/, "");
const config = await loadAppConfig(`.ts`);

if (!config.helmReleases?.length) {
	console.error(`App '' has no helmReleases`);
	process.exit(1);
}

const namespace = appNamespace(config);
const tempDir = mkdtempSync(join(tmpdir(), "render-chart-"));

try {
	for (const release of config.helmReleases) {
		console.log(`# release: `);
		console.log(await templateRelease(release, namespace, tempDir));
	}
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
