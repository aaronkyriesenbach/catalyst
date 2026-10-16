import { readdirSync } from "node:fs";
import { type Job, runJobs } from "./job-runner";

const outDir = process.argv[2];

if (!outDir) {
  console.error("Usage: bun run render-all <outdir>");
  process.exit(1);
}

const appNames = readdirSync("apps", { withFileTypes: true })
  .flatMap((entry) =>
    entry.isFile() && entry.name.endsWith(".ts")
      ? [entry.name.replace(/\.ts$/, "")]
      : [],
  )
  .sort((a, b) => a.localeCompare(b));

const jobs: Job[] = [
  ...appNames.flatMap((name) => [
    { label: `render-${name}`, args: ["render", name] },
    {
      label: `render-argo-app-${name}`,
      args: ["render", "argo", "app", name],
    },
  ]),
  {
    label: "render-argo-project-system",
    args: ["render", "argo", "project", "system"],
  },
  { label: "main", args: ["main.ts"] },
];

process.exit((await runJobs(outDir, jobs)) ? 0 : 1);
