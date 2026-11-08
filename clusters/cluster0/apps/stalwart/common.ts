export const stalwartName = "stalwart";
export const stalwartPort = 8080;
export const stalwartServiceUrl = `http://${stalwartName}.${stalwartName}.svc:${stalwartPort}`;

export const recoveryAdminSecretName = `${stalwartName}-recovery-admin`;
export const recoveryAdminUser = "admin";

export const webUiClientId = stalwartName;
export const webUiRedirectPaths = [
  "/admin/oauth/callback",
  "/account/oauth/callback",
] as const;
