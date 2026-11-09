import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Cluster, ClusterDefinition } from "./types";

export const CLUSTERS_DIR = fileURLToPath(
  new URL("../../clusters/", import.meta.url),
);

// A directory without apps/ (clusters/omni) is Pulumi-only, not a catalyst cluster.
export function listClusters(): string[] {
  return readdirSync(CLUSTERS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && existsSync(`${CLUSTERS_DIR}${entry.name}/apps`),
    )
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
  const definition: ClusterDefinition = mod.default;

  return { ...definition, name };
}
