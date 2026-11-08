import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./types";

const CLUSTERS_DIR = fileURLToPath(new URL("../../clusters/", import.meta.url));

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

export function clusterAppsDir(cluster: string = currentCluster()): string {
  return `${CLUSTERS_DIR}${cluster}/apps/`;
}

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`${clusterAppsDir()}${path}`);

  return mod.default;
}

export async function loadAllAppConfigs(
  exclude: readonly string[] = [],
): Promise<AppConfig[]> {
  const files = readdirSync(clusterAppsDir(), { withFileTypes: true })
    .filter((entry) => entry.isFile() && !exclude.includes(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const configs: AppConfig[] = [];

  for (const file of files) {
    configs.push(await loadAppConfig(file));
  }

  return configs;
}

export function appNamespace(config: AppConfig): string {
  return config.namespace ?? config.name;
}
