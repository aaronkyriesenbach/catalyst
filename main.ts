import { stringify } from "yaml";
import { projectDefinitions } from "./constants";
import {
  buildApplication,
  buildProject,
  loadAllAppConfigs,
  loadAppConfig,
  renderAppFromConfig,
} from "./utils";

const appName = process.env.ARGOCD_ENV_APP;

if (appName) {
  await renderAppFromConfig(await loadAppConfig(`${appName}.ts`));
} else {
  const resources: string[] = [];

  for (const [name, spec] of Object.entries(projectDefinitions)) {
    resources.push(stringify(buildProject(name, spec)));
  }

  for (const appConfig of await loadAllAppConfigs()) {
    resources.push(stringify(buildApplication(appConfig)));
  }

  console.log(resources.join("\n---\n"));
}
