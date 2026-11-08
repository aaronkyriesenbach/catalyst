import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const usage = `Usage: bun run diff-renders <base-dir> <head-dir>

Takes two directories written by render-all or render-charts, splits every
rendered output into one file per Kubernetes resource
(<app>/[<namespace>/]<Kind>-<name>.yaml) and prints a summary of the resources
that changed followed by a unified diff of each. Prints nothing when nothing
changed.`;

const labelPrefixes: [prefix: string, group: (rest: string) => string][] = [
  ["render-argo-app-", (app) => app],
  ["render-argo-project-", () => "projects"],
  ["render-", (app) => app],
  ["chart-", (app) => app],
];

type Resource = {
  kind?: unknown;
  metadata?: { name?: unknown; namespace?: unknown };
};

type Change = {
  status: "added" | "removed" | "modified";
  path: string;
  diff: string;
};

function statusOf(inBase: boolean, inHead: boolean): Change["status"] {
  if (!inBase) {
    return "added";
  }

  return inHead ? "modified" : "removed";
}

function groupFor(label: string): string | null {
  for (const [prefix, group] of labelPrefixes) {
    if (label.startsWith(prefix)) {
      return group(label.slice(prefix.length));
    }
  }

  // `main` repeats every Application already in the render-argo-app-* outputs.
  return null;
}

function isResource(value: unknown): value is Resource {
  return typeof value === "object" && value !== null && "kind" in value;
}

function resourcePath(group: string, resource: Resource): string | null {
  const { kind, metadata } = resource;

  if (typeof kind !== "string" || typeof metadata?.name !== "string") {
    return null;
  }

  const { namespace } = metadata;
  const dir =
    typeof namespace === "string" && namespace !== group
      ? join(group, namespace)
      : group;

  return join(dir, `${kind}-${metadata.name.replaceAll("/", "_")}.yaml`);
}

function splitDocuments(text: string): string[] {
  return text
    .split(/^---[ \t]*$/m)
    .map((chunk) => chunk.replace(/^# release: .*$/gm, "").trim())
    .filter((chunk) => chunk !== "");
}

async function writeResources(srcDir: string, outDir: string): Promise<void> {
  const used = new Set<string>();

  for (const file of readdirSync(srcDir).sort((a, b) => a.localeCompare(b))) {
    if (!file.endsWith(".out")) {
      continue;
    }

    const group = groupFor(file.replace(/\.out$/, ""));

    if (group === null) {
      continue;
    }

    const text = await Bun.file(join(srcDir, file)).text();

    for (const doc of splitDocuments(text)) {
      const parsed: unknown = parse(doc);
      const initial = isResource(parsed) ? resourcePath(group, parsed) : null;

      if (initial === null) {
        continue;
      }

      let path = initial;

      for (let n = 2; used.has(path); n++) {
        path = initial.replace(/\.yaml$/, `-${n}.yaml`);
      }

      used.add(path);
      mkdirSync(dirname(join(outDir, path)), { recursive: true });
      await Bun.write(join(outDir, path), `${doc}\n`);
    }
  }
}

function listFiles(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true }).flatMap(
    (entry) =>
      entry.isFile()
        ? [join(entry.parentPath, entry.name).slice(root.length + 1)]
        : [],
  );
}

async function readIfExists(path: string): Promise<string | null> {
  const file = Bun.file(path);

  return (await file.exists()) ? file.text() : null;
}

async function unifiedDiff(
  baseFile: string,
  headFile: string,
  path: string,
): Promise<string> {
  const proc = Bun.spawn(
    [
      "diff",
      "-uN",
      "--label",
      `a/${path}`,
      "--label",
      `b/${path}`,
      baseFile,
      headFile,
    ],
    { stdout: "pipe", stderr: "inherit" },
  );
  const [output, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  // Exit 1 just means the files differ.
  if (exitCode > 1) {
    throw new Error(`diff failed for ${path}`);
  }

  return output;
}

const [baseDir, headDir] = process.argv.slice(2);

if (!baseDir || !headDir) {
  console.error(usage);
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "diff-renders-"));

try {
  const baseTree = join(tempDir, "base");
  const headTree = join(tempDir, "head");

  mkdirSync(baseTree);
  mkdirSync(headTree);
  await writeResources(baseDir, baseTree);
  await writeResources(headDir, headTree);

  const baseFiles = new Set(listFiles(baseTree));
  const headFiles = new Set(listFiles(headTree));
  const paths = [...new Set([...baseFiles, ...headFiles])].sort((a, b) =>
    a.localeCompare(b),
  );
  const changes: Change[] = [];

  for (const path of paths) {
    const base = join(baseTree, path);
    const head = join(headTree, path);

    if ((await readIfExists(base)) === (await readIfExists(head))) {
      continue;
    }

    const status = statusOf(baseFiles.has(path), headFiles.has(path));

    changes.push({ status, path, diff: await unifiedDiff(base, head, path) });
  }

  if (changes.length > 0) {
    console.log(`${changes.length} changed resource(s):`);

    for (const { status, path } of changes) {
      console.log(`  ${status.padEnd(8)} ${path}`);
    }

    console.log();
    console.log(changes.map(({ diff }) => diff.trimEnd()).join("\n\n"));
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
