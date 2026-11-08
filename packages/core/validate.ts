import { appHostname } from "@catalyst/platform/hostnames";
import type { Catalog } from "./types";

export function validateCatalog(catalog: Catalog): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const hostOwners = new Map<string, string>();
  const hasAuthentik = catalog.entries.some(
    (entry) => entry.config.name === "authentik",
  );

  function claimHost(host: string, owner: string): void {
    const existing = hostOwners.get(host);

    if (existing !== undefined) {
      problems.push(`${host} is served by both ${existing} and ${owner}`);
    }

    hostOwners.set(host, owner);
  }

  for (const { cluster, file, config } of catalog.entries) {
    const id = `${cluster}/${config.name}`;

    if (file !== `${config.name}.ts`) {
      problems.push(
        `${cluster}/${file} declares name '${config.name}'; the CMP loads apps by file name, so they must match`,
      );
    }

    if (seen.has(id)) {
      problems.push(`App '${config.name}' is declared twice on ${cluster}`);
    }

    seen.add(id);

    if (config.kind === "workload" && config.webPort !== undefined) {
      claimHost(
        appHostname(config.name, {
          subDomain: config.subDomain,
          externallyAccessible: config.externallyAccessible,
        }),
        id,
      );
    }

    for (const extra of config.additionalOidc ?? []) {
      claimHost(
        appHostname(extra.name, {
          subDomain: extra.subDomain,
          externallyAccessible: extra.externallyAccessible,
        }),
        `${id} (${extra.name})`,
      );
    }

    if (
      !hasAuthentik &&
      (config.oidc !== undefined || config.additionalOidc !== undefined)
    ) {
      problems.push(`${id} declares oidc but no app named authentik exists`);
    }
  }

  return problems;
}
