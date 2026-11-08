import { cluster } from "@catalyst/core/cluster";
import { buildApplication, buildProject } from "@catalyst/argocd/application";
import { loadAllAppConfigs, loadAppConfig } from "@catalyst/core/apps";
import { renderAppFromConfig } from "@catalyst/core/render";
import { toYaml } from "@catalyst/core/yaml";

const appName = process.env.ARGOCD_ENV_APP;

if (appName) {
  await renderAppFromConfig(await loadAppConfig(`${appName}.ts`));
} else {
  const resources: string[] = [];

  for (const [name, spec] of Object.entries(cluster.gitops.projects)) {
    resources.push(toYaml(buildProject(name, spec)));
  }

  for (const appConfig of await loadAllAppConfigs()) {
    resources.push(toYaml(buildApplication(appConfig, cluster)));
  }

  console.log(resources.join("\n---\n"));
}
