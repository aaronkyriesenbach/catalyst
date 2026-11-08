import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "./types";

const APPS_DIR = fileURLToPath(new URL("../../apps/", import.meta.url));

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`${APPS_DIR}${path}`);

  return mod.default;
}

// `exclude` stops an aggregating app (authentik) from awaiting its own import. Sequential on
// purpose: the CMP has no node_modules, and concurrent imports race Bun's auto-install.
export async function loadAllAppConfigs(
  exclude: readonly string[] = [],
): Promise<AppConfig[]> {
  const files = readdirSync(APPS_DIR, { withFileTypes: true })
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
