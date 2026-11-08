import { projectDefinitions } from "@catalyst/core/constants";
import { buildApplication, buildProject } from "@catalyst/argocd/application";
import { loadAllAppConfigs, loadAppConfig } from "@catalyst/core/apps";
import { renderAppFromConfig } from "@catalyst/core/render";
import { toYaml } from "@catalyst/core/yaml";

const appName = process.env.ARGOCD_ENV_APP;

if (appName) {
  await renderAppFromConfig(await loadAppConfig(`${appName}.ts`));
} else {
  const resources: string[] = [];

  for (const [name, spec] of Object.entries(projectDefinitions)) {
    resources.push(toYaml(buildProject(name, spec)));
  }

  for (const appConfig of await loadAllAppConfigs()) {
    resources.push(toYaml(buildApplication(appConfig)));
  }

  console.log(resources.join("\n---\n"));
}
