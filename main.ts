import { projectDefinitions } from "./constants";
import {
  buildApplication,
  buildProject,
  loadAllAppConfigs,
  loadAppConfig,
  renderAppFromConfig,
  toYaml,
} from "./utils";

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
