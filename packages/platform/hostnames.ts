import { site } from "@catalyst/site";

export type HostOptions = {
  subDomain?: string;
  externallyAccessible?: boolean;
};

export function appHostname(name: string, options?: HostOptions): string {
  const { subDomain, externallyAccessible } = options ?? {};
  return `${subDomain ?? name}${externallyAccessible ? "" : ".int"}.${site.domain}`;
}

export function appUrl(name: string, options?: HostOptions): string {
  return `https://${appHostname(name, options)}`;
}
