import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type Job, runJobs } from "./job-runner";

const outDir = process.argv[2];

if (!outDir) {
  console.error("Usage: bun run render-charts <outdir>");
  process.exit(1);
}

const appNames = readdirSync("apps", { withFileTypes: true }).flatMap(
  (entry) =>
    entry.isFile() && entry.name.endsWith(".ts")
      ? [entry.name.replace(/\.ts$/, "")]
      : [],
);

// Text scan, not loadAppConfig: CI runs this against the base checkout and must not import head app code.
const jobs: Job[] = [];

for (const name of appNames.sort((a, b) => a.localeCompare(b))) {
  const source = await Bun.file(join("apps", `${name}.ts`)).text();

  if (source.includes("helmReleases")) {
    jobs.push({ label: `chart-${name}`, args: ["render-chart", name] });
  }
}

process.exit((await runJobs(outDir, jobs)) ? 0 : 1);
