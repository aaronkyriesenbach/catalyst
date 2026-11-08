import { StatusGroup } from "@catalyst/platform/status";

export const gatusName = "gatus";
export const gatusPort = 8080;
export const gatusUrl = `http://${gatusName}.${gatusName}.svc:${gatusPort}`;

export const heartbeatSecretName = `${gatusName}-heartbeat`;
export const heartbeatSecretKey = "token";
export const heartbeatTokenEnv = "GATUS_HEARTBEAT_TOKEN";

export const notifierKey = gatusName;

const KEY_SEPARATORS = /[ /_,.#+&]/g;

const sanitizeKeyPart = (part: string) =>
  part.trim().toLowerCase().replace(KEY_SEPARATORS, "-");

export function endpointKey(group: string, name: string): string {
  return `${sanitizeKeyPart(group)}_${sanitizeKeyPart(name)}`;
}

export function heartbeatKey(name: string): string {
  return endpointKey(StatusGroup.Certificates, name);
}
