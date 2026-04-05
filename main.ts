import { Application } from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
import { readdirSync } from "fs";
import { stringify } from "yaml";
import { loadAppConfig, renderAppFromConfig } from "./utils";
import { AppConfig } from "./types";

if (process.env.ARGOCD_ENV_APP_CONFIG) {
  const config = JSON.parse(process.env.ARGOCD_ENV_APP_CONFIG) as AppConfig;

  renderAppFromConfig(config);
} else {
  const resources: string[] = [];

  for (const entry of readdirSync("apps")) {
    const appConfig = await loadAppConfig(entry);
    const { name, namespace } = appConfig;

    const app = new Application({
      metadata: {
        name: name,
        namespace: "argocd",
      },
      spec: {
        project: "default",
        source: {
          repoURL: "https://github.com/aaronkyriesenbach/catalyst",
          path: ".",
          plugin: {
            env: [
              {
                name: "APP_CONFIG",
                value: JSON.stringify(appConfig),
              },
            ],
          },
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: namespace ?? name,
        },
      },
    });

    resources.push(stringify(app));
  }

  console.log(resources.join("\n---\n"));
}
