import { Deployment } from "kubernetes-models/apps/v1";
import { AppConfig } from "./types";
import { stringify } from "yaml";

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

export function renderAppFromConfig(config: AppConfig) {
  const { name, podSpec } = config;

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

  console.log(stringify(deployment));
}
