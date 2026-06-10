import { stringify } from "yaml";
import { Project, projectDefinitions } from "../constants";
import { buildApplication, buildProject, loadAppConfig } from "../utils";

const usage =
  "Usage: bun run render <app-name> | bun run render argo <app|project> <name>";

function moduleName(name: string): string {
  return name.endsWith(".ts") ? name : `${name}.ts`;
}

function isKnownProject(name: string): name is Project {
  return (Object.values(Project) as string[]).includes(name);
}

const arg1 = process.argv[2];

if (arg1 === "argo") {
  const kind = process.argv[3];
  const name = process.argv[4];

  if (!name || (kind !== "app" && kind !== "project")) {
    console.error(usage);
    process.exit(1);
  }

  if (kind === "project") {
    if (!isKnownProject(name)) {
      console.error(
        `Unknown project '${name}'. Known projects: ${Object.keys(projectDefinitions).join(", ")}`,
      );
      process.exit(1);
    }

    console.log(stringify(buildProject(name, projectDefinitions[name])));
  } else {
    const appConfig = await loadAppConfig(moduleName(name));
    console.log(stringify(buildApplication(appConfig)));
  }
} else {
  if (!arg1) {
    console.error(usage);
    process.exit(1);
  }

  const appConfig = await loadAppConfig(moduleName(arg1));

  process.env.ARGOCD_ENV_APP_CONFIG = JSON.stringify(appConfig);

  await import("../main");
}
