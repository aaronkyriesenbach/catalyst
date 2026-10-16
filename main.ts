import { readdirSync } from "fs";
import { stringify } from "yaml";
import { projectDefinitions } from "./constants";
import {
  buildApplication,
  buildProject,
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

  for (const entry of readdirSync("apps", { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)) {
    const appConfig = await loadAppConfig(entry);

    resources.push(stringify(buildApplication(appConfig)));
  }

  console.log(resources.join("\n---\n"));
}
