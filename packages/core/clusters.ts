import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Cluster } from "./types";

export const CLUSTERS_DIR = fileURLToPath(
  new URL("../../clusters/", import.meta.url),
);

export function listClusters(): string[] {
  return readdirSync(CLUSTERS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export function currentCluster(): string {
  const requested = process.env.ARGOCD_ENV_CLUSTER;
  const clusters = listClusters();

  if (requested !== undefined && requested !== "") {
    if (!clusters.includes(requested)) {
      throw new Error(
        `Unknown cluster '${requested}'. Known clusters: ${clusters.join(", ")}`,
      );
    }

    return requested;
  }

  const [only, ...others] = clusters;

  if (only === undefined || others.length > 0) {
    throw new Error(
      `Set ARGOCD_ENV_CLUSTER to one of: ${clusters.join(", ") || "(none)"}`,
    );
  }

  return only;
}

export async function loadCluster(name: string): Promise<Cluster> {
  const mod = await import(`${CLUSTERS_DIR}${name}/cluster.ts`);
  const cluster: Cluster = mod.default;

  if (cluster.name !== name) {
    throw new Error(
      `clusters/${name}/cluster.ts declares name '${cluster.name}'`,
    );
  }

  return cluster;
}
