import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const clusterDir = resolve(import.meta.dir, "..", "cluster");
const remotePath = "/var/lib/rancher/k3s/server/manifests";
const excludedFiles = new Set([
	"argocd-values.yaml",
	"catalyst-app.yaml",
	"README.md",
]);

type Options = {
	node: string;
	dryRun: boolean;
};

function parseArgs(args: string[]): Options {
	let node: string | undefined;
	let dryRun = false;

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (arg === "--dry-run") {
			dryRun = true;
			continue;
		}

		if (arg === "--help") {
			console.log(
				[
					"Usage: bun run apply-cluster <node> [--dry-run]",
					"",
					"Syncs cluster manifests to /var/lib/rancher/k3s/server/manifests/",
					"on the specified k3s server node over SSH.",
					"",
					"Options:",
					"  --dry-run  Show what would change without applying",
				].join("\n"),
			);
			process.exit(0);
		}

		if (arg?.startsWith("-")) {
			throw new Error(`Unknown option: ${arg}`);
		}

		if (node) {
			throw new Error(`Unexpected argument: ${arg}`);
		}

		node = arg;
	}

	if (!node) {
		console.error("Usage: bun run apply-cluster <node> [--dry-run]");
		process.exit(1);
	}

	return { node, dryRun };
}

async function getManifestFiles(): Promise<string[]> {
	const entries = await readdir(clusterDir);
	return entries
		.filter((entry) => entry.endsWith(".yaml") && !excludedFiles.has(entry))
		.sort();
}

// ssh itself exits 255 on connection or host-key errors; a missing remote file exits 1 from `cat`.
const SSH_FAILURE_EXIT_CODE = 255;

async function getRemoteFileContent(
	node: string,
	filePath: string,
): Promise<string | null> {
	const proc = Bun.spawn({
		cmd: ["ssh", node, `sudo cat '${filePath}' 2>/dev/null`],
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode === SSH_FAILURE_EXIT_CODE) {
		throw new Error(`ssh ${node} failed: ${stderr.trim()}`);
	}

	return exitCode === 0 ? stdout : null;
}

// Written to a temp name first because k3s applies a manifest as soon as the file changes.
async function writeRemoteFile(
	node: string,
	filePath: string,
	content: string,
): Promise<void> {
	const tempPath = `${filePath}.tmp`;
	const proc = Bun.spawn({
		cmd: [
			"ssh",
			node,
			`sudo tee '${tempPath}' >/dev/null && sudo mv '${tempPath}' '${filePath}'`,
		],
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	proc.stdin.write(content);
	proc.stdin.end();

	const [stderr, exitCode] = await Promise.all([
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	if (exitCode !== 0) {
		throw new Error(
			`Failed to write ${node}:${filePath}: ${stderr.trim() || `exit code ${exitCode}`}`,
		);
	}
}

async function computeDiff(
	remoteContent: string,
	localPath: string,
	remoteLabel: string,
	localLabel: string,
): Promise<string> {
	const proc = Bun.spawn({
		cmd: [
			"diff",
			"-u",
			"--label",
			remoteLabel,
			"--label",
			localLabel,
			"-",
			localPath,
		],
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});

	if (proc.stdin) {
		proc.stdin.write(remoteContent);
		proc.stdin.end();
	}

	const [stdout] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return stdout;
}

const options = parseArgs(process.argv.slice(2));
const files = await getManifestFiles();

if (files.length === 0) {
	console.log("No manifest files found to sync.");
	process.exit(0);
}

if (options.dryRun) {
	console.log(
		`[dry-run] Comparing ${files.length} manifest(s) against ${options.node}:${remotePath}/\n`,
	);

	let changesFound = false;

	for (const file of files) {
		const localPath = join(clusterDir, file);
		const remoteFilePath = `${remotePath}/${file}`;
		const remoteContent = await getRemoteFileContent(
			options.node,
			remoteFilePath,
		);
		const localContent = await Bun.file(localPath).text();

		if (remoteContent === null) {
			console.log(`+ ${file} (new file)`);
			changesFound = true;
		} else if (remoteContent === localContent) {
			console.log(`  ${file} (unchanged)`);
		} else {
			console.log(`~ ${file} (modified)`);
			const diff = await computeDiff(
				remoteContent,
				localPath,
				`${options.node}:${remoteFilePath}`,
				`cluster/${file}`,
			);
			if (diff) {
				console.log(diff);
			}
			changesFound = true;
		}
	}

	if (!changesFound) {
		console.log("\nAll manifests are up to date.");
	} else {
		console.log("\n[dry-run] No changes applied.");
	}
} else {
	let updated = 0;

	for (const file of files) {
		const remoteFilePath = `${remotePath}/${file}`;
		const localContent = await Bun.file(join(clusterDir, file)).text();
		const remoteContent = await getRemoteFileContent(
			options.node,
			remoteFilePath,
		);

		if (remoteContent === localContent) {
			console.log(`  ${file} (unchanged)`);
			continue;
		}

		await writeRemoteFile(options.node, remoteFilePath, localContent);
		console.log(`${remoteContent === null ? "+" : "~"} ${file}`);
		updated += 1;
	}

	console.log(
		`\nSynced ${updated} of ${files.length} manifest(s) to ${options.node}:${remotePath}/`,
	);
}
