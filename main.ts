import { readdirSync } from "fs";
import { stringify } from "yaml";
import { projectDefinitions } from "./constants";
import type { AppConfig } from "./types";
import {
  buildApplication,
  buildProject,
  loadAppConfig,
  renderAppFromConfig,
} from "./utils";

if (process.env.ARGOCD_ENV_APP_CONFIG) {
  const config = JSON.parse(process.env.ARGOCD_ENV_APP_CONFIG) as AppConfig;

  await renderAppFromConfig(config);
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
