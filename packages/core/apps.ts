import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppConfig, Catalog, CatalogEntry, DeriveContext } from "./types";

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

function listAppFiles(cluster: string): string[] {
  return readdirSync(clusterAppsDir(cluster), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

async function importApp(cluster: string, file: string): Promise<AppConfig> {
  const mod = await import(`${clusterAppsDir(cluster)}${file}`);

  return mod.default;
}

function createCatalog(entries: readonly CatalogEntry[]): Catalog {
  return {
    entries,
    onCluster: (cluster) =>
      entries
        .filter((entry) => entry.cluster === cluster)
        .map((entry) => entry.config),
  };
}

async function buildCatalog(): Promise<Catalog> {
  const entries: CatalogEntry[] = [];

  for (const cluster of listClusters()) {
    for (const file of listAppFiles(cluster)) {
      entries.push({ cluster, config: await importApp(cluster, file) });
    }
  }

  return createCatalog(entries);
}

let catalog: Promise<Catalog> | undefined;

export function loadCatalog(): Promise<Catalog> {
  catalog ??= buildCatalog();

  return catalog;
}

function resolveApp(config: AppConfig, context: DeriveContext): AppConfig {
  if (config.kind === "static") {
    const { derive, ...declared } = config;

    if (derive === undefined) {
      return config;
    }

    const derived = derive(context);

    return {
      ...declared,
      resources: [...(declared.resources ?? []), ...(derived.resources ?? [])],
      helmReleases: [
        ...(declared.helmReleases ?? []),
        ...(derived.helmReleases ?? []),
      ],
    };
  }

  const { derive, ...declared } = config;

  if (derive === undefined) {
    return config;
  }

  const derived = derive(context);

  return {
    ...declared,
    extraResources: [
      ...(declared.extraResources ?? []),
      ...(derived.extraResources ?? []),
    ],
    helmReleases: [
      ...(declared.helmReleases ?? []),
      ...(derived.helmReleases ?? []),
    ],
  };
}

async function loadResolved(cluster: string, file: string): Promise<AppConfig> {
  const config = await importApp(cluster, file);

  if (config.derive === undefined) {
    return config;
  }

  return resolveApp(config, { catalog: await loadCatalog(), cluster });
}

export function loadAppConfig(file: string): Promise<AppConfig> {
  return loadResolved(currentCluster(), file);
}

export async function loadAllAppConfigs(): Promise<AppConfig[]> {
  const cluster = currentCluster();
  const configs: AppConfig[] = [];

  for (const file of listAppFiles(cluster)) {
    configs.push(await loadResolved(cluster, file));
  }

  return configs;
}

export function appNamespace(config: AppConfig): string {
  return config.namespace ?? config.name;
}
