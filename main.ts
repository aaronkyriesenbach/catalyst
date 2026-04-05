import { Application } from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1/Application";
import { stringify } from "@std/yaml";

if (Deno.env.has("ARGOCD_ENV_APP_CONFIG")) {
  // Render app from config here
} else {
  for (const entry of Deno.readDirSync("apps")) {
    const app = new Application({
      metadata: {
        name: entry.name,
      },
      spec: {
        project: "default",
        source: {
          repoURL: "https://github.com/aaronkyriesenbach/catalyst",
          plugin: {
            env: [
              {
                name: "APP_CONFIG",
                value: "APP_CONFIG_HERE",
              },
            ],
          },
        },
        destination: {
          server: "https://kubernetes.default.svc",
          namespace: entry.name,
        },
      },
    });

    console.log(stringify(app.toJSON()));
  }
}
