import { loadAppConfig } from "./utils";

const requestedApp = process.argv[2];

if (!requestedApp) {
  console.error("Usage: bun run render <app-name>");
  process.exit(1);
}

const appModuleName = requestedApp.endsWith(".ts")
  ? requestedApp
  : `${requestedApp}.ts`;
const appConfig = await loadAppConfig(appModuleName);

process.env.ARGOCD_ENV_APP_CONFIG = JSON.stringify(appConfig);

await import("./main");
