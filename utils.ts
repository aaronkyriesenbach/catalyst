import { Deployment } from "kubernetes-models/apps/v1";
import { AppConfig } from "./types";
import { stringify } from "yaml";
import { Model } from "@kubernetes-models/base";

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

export function renderAppFromConfig(config: AppConfig) {
  const { name, podSpec, extraResources } = config;
  const resources: string[] = extraResources?.map((r) => stringify(r)) ?? [];

  if (podSpec) {
    const deployment = new Deployment({
      metadata: {
        name,
        labels: {
          app: name,
        },
      },
      spec: {
        selector: {
          matchLabels: {
            app: name,
          },
        },
        template: {
          metadata: {
            labels: {
              app: name,
            },
          },
          spec: podSpec,
        },
      },
    });

    resources.push(stringify(deployment));
  }

  const rendered = resources.map((r) => stringify(r));
  console.log(rendered.join("\n---\n"));
}
