import { site } from "@catalyst/site";

export function awsSecretKey(
  cluster: string,
  namespace: string,
  name: string,
): string {
  return `${site.awsSecretsPrefix}/${cluster}/${namespace}/${name}`;
}
