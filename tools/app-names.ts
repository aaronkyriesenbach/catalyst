import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function appsDirectory(root: string = process.cwd()): string {
  const clustersDir = join(root, "clusters");

  if (!existsSync(clustersDir)) {
    return join(root, "apps");
  }

  const clusters = readdirSync(clustersDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(clustersDir, entry.name, "apps")),
    )
    .map((entry) => entry.name);
  const requested = process.env.ARGOCD_ENV_CLUSTER;
  const cluster = requested
    ? requested
    : clusters.length === 1
      ? clusters[0]
      : undefined;

  if (cluster === undefined || !clusters.includes(cluster)) {
    throw new Error(
      `Set ARGOCD_ENV_CLUSTER to one of: ${clusters.join(", ") || "(none)"}`,
    );
  }

  return join(clustersDir, cluster, "apps");
}

export function listAppNames(dir: string = appsDirectory()): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isFile() && entry.name.endsWith(".ts")
        ? [entry.name.replace(/\.ts$/, "")]
        : [],
    )
    .sort((a, b) => a.localeCompare(b));
}
