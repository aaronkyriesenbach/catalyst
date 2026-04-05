import { Application } from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
import { readdirSync } from "fs";
import { stringify } from "yaml";
import { loadAppConfig, renderAppFromConfig } from "./utils";
import { AppConfig } from "./types";

if (process.env.ARGOCD_ENV_APP_CONFIG) {
  const config = JSON.parse(process.env.ARGOCD_ENV_APP_CONFIG) as AppConfig;

  renderAppFromConfig(config);
} else {
  for (const entry of readdirSync("apps")) {
    const appConfig = await loadAppConfig(entry);
    const { name, namespace } = appConfig;

    const app = new Application({
      metadata: {
        name: name,
      },
      spec: {
        project: "default",
        source: {
          repoURL: "https://github.com/aaronkyriesenbach/catalyst",
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

    console.log(stringify(app));
  }
}
