import { Application, AppProject } from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
import { readdirSync } from "fs";
import { stringify } from "yaml";
import { projectDefinitions } from "./constants";
import type { AppConfig } from "./types";
import { loadAppConfig, renderAppFromConfig } from "./utils";

if (process.env.ARGOCD_ENV_APP_CONFIG) {
  const config = JSON.parse(process.env.ARGOCD_ENV_APP_CONFIG) as AppConfig;

  await renderAppFromConfig(config);
} else {
  const resources: string[] = [];

  for (const [name, spec] of Object.entries(projectDefinitions)) {
    const project = new AppProject({
      metadata: {
        name,
        namespace: "argocd",
        annotations: { "argocd.argoproj.io/sync-wave": "-1" },
      },
      spec,
    });

    resources.push(stringify(project));
  }

  for (const entry of readdirSync("apps", { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)) {
    const appConfig = await loadAppConfig(entry);
    const { name, namespace, project } = appConfig;

    const app = new Application({
      metadata: {
        name: name,
        namespace: "argocd",
        finalizers: ["resources-finalizer.argocd.argoproj.io"],
      },
      spec: {
        project: project ?? "default",
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
