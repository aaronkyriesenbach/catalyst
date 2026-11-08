import { parseAllDocuments } from "yaml";

export type RenderedApp = { name: string; documents: readonly string[] };

type RouteDocument = {
  kind?: string;
  metadata?: { name?: string };
  spec?: { hostnames?: string[] };
};

export function findDuplicateRouteHosts(
  apps: readonly RenderedApp[],
): string[] {
  const owners = new Map<string, string[]>();

  for (const app of apps) {
    for (const text of app.documents) {
      for (const parsed of parseAllDocuments(text)) {
        const route = parsed.toJSON() as RouteDocument | null;

        if (route?.kind !== "HTTPRoute") {
          continue;
        }

        for (const host of route.spec?.hostnames ?? []) {
          const owner = `${app.name}/${route.metadata?.name}`;

          owners.set(host, [...(owners.get(host) ?? []), owner]);
        }
      }
    }
  }

  return [...owners]
    .filter(([, routes]) => routes.length > 1)
    .map(([host, routes]) => `${host} is served by ${routes.join(" and ")}`);
}
