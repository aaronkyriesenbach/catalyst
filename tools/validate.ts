import { loadAllAppConfigs } from "@catalyst/core/apps";
import { renderApp } from "@catalyst/core/render";
import {
  findDuplicateRouteHosts,
  type RenderedApp,
} from "@catalyst/core/validate";

const apps: RenderedApp[] = [];

for (const config of await loadAllAppConfigs()) {
  apps.push({
    name: config.name,
    documents: await renderApp(config, { fetchRemote: false }),
  });
}

const problems = findDuplicateRouteHosts(apps);

for (const problem of problems) {
  console.error(`error: ${problem}`);
}

console.log(`Rendered ${apps.length} apps: ${problems.length} problem(s)`);
process.exit(problems.length > 0 ? 1 : 0);
