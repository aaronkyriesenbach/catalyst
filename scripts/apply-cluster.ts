import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const clusterDir = resolve(import.meta.dir, "..", "cluster");
const remotePath = "/var/lib/rancher/k3s/server/manifests";
const excludedFiles = new Set(["argocd-values.yaml", "README.md"]);

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
          "on the specified k3s server node via rsync over SSH.",
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

async function runCommand(command: string[]) {
  const proc = Bun.spawn({
    cmd: command,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${command.join(" ")}`,
        stderr.trim() || stdout.trim() || `exit code ${exitCode}`,
      ].join("\n"),
    );
  }

  return stdout;
}

async function getManifestFiles(): Promise<string[]> {
  const entries = await readdir(clusterDir);
  return entries
    .filter((entry) => entry.endsWith(".yaml") && !excludedFiles.has(entry))
    .sort();
}

async function getRemoteFileContent(
  node: string,
  filePath: string,
): Promise<string | null> {
  const proc = Bun.spawn({
    cmd: ["ssh", node, `sudo cat '${filePath}' 2>/dev/null`],
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return exitCode === 0 ? stdout : null;
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
  const localPaths = files.map((file) => join(clusterDir, file));

  const output = await runCommand([
    "rsync",
    "-avc",
    "--checksum",
    "--rsync-path=sudo rsync",
    ...localPaths,
    `${options.node}:${remotePath}/`,
  ]);

  if (output.trim()) {
    console.log(output.trimEnd());
  }

  console.log(
    `\nSynced ${files.length} manifest(s) to ${options.node}:${remotePath}/`,
  );
}
