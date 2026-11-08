import { StatusGroup } from "../../status";

export const gatusName = "gatus";
export const gatusPort = 8080;
export const gatusUrl = `http://${gatusName}.${gatusName}.svc:${gatusPort}`;

export const heartbeatSecretName = `${gatusName}-heartbeat`;
export const heartbeatSecretKey = "token";
export const heartbeatTokenEnv = "GATUS_HEARTBEAT_TOKEN";

export const notifierKey = gatusName;

const KEY_SEPARATORS = /[ /_,.#+&]/g;

export function heartbeatKey(name: string): string {
  const sanitize = (part: string) => part.replace(KEY_SEPARATORS, "-");

  return `${sanitize(StatusGroup.Certificates)}_${sanitize(name)}`;
}
