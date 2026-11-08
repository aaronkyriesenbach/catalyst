import { join } from "node:path";
import { appsDirectory, listAppNames } from "./app-names";
import { type Job, runJobs } from "./job-runner";

const outDir = process.argv[2];

if (!outDir) {
  console.error("Usage: bun run render-charts <outdir>");
  process.exit(1);
}

const appsDir = appsDirectory();
const jobs: Job[] = [];

for (const name of listAppNames(appsDir)) {
  const source = await Bun.file(join(appsDir, `${name}.ts`)).text();

  if (source.includes("helmReleases")) {
    jobs.push({ label: `chart-${name}`, args: ["render-chart", name] });
  }
}

process.exit((await runJobs(outDir, jobs)) ? 0 : 1);
