import { ApiObject, App, AppProps, YamlOutputType } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { parseAllDocuments } from "jsr:@eemeli/yaml";
import * as path from "jsr:@std/path";
import { Container, VolumeMount } from "./imports/k8s.ts";
import { NasVolumeMount, NasVolumeMountMap } from "./Pod.ts";
import { NAS_VOLUME_NAME } from "./constants.ts";
import { ArgoCDApplication, ArgoCDApplicationSpec } from "./ArgoCDApplication.ts";

export function readTextFileSync(filename: string) {
  return Deno.readTextFileSync(
    path.resolve(Deno.env.get("INIT_CWD")!, filename),
  );
}

export function createResourcesFromYaml(
  scope: Construct,
  filename: string,
  useYaml11?: boolean,
): ApiObject[] {
  const resourceYaml = readTextFileSync(filename);
  const resources = parseAllDocuments(
    resourceYaml,
    useYaml11 ? { version: "1.1" } : undefined,
  );

  return resources.map((r) =>
    new ApiObject(scope, crypto.randomUUID(), r.toJS())
  );
}

export function getInjectedVolumeMount(
  nasVolumeMount: NasVolumeMount,
): VolumeMount {
  return {
    name: NAS_VOLUME_NAME,
    ...nasVolumeMount,
  };
}

export function injectContainers(
  containers?: Container[],
  nasVolumeMounts?: NasVolumeMountMap,
) {
  if (!containers || !nasVolumeMounts) {
    return containers;
  }

  const containersToInject = Object.keys(nasVolumeMounts);

  const nonInjectedContainers = containers.filter((c) =>
    !containersToInject.includes(c.name)
  );

  const injectedContainers: Container[] = containers.filter((c) =>
    containersToInject.includes(c.name)
  ).map((c) => ({
    ...c,
    volumeMounts: [
      ...nasVolumeMounts[c.name].map((vm) =>
        getInjectedVolumeMount(vm)
      ) as VolumeMount[],
      ...(c.volumeMounts ?? []),
    ],
  }));

  return [...nonInjectedContainers, ...injectedContainers];
}

export class Lab53App extends App {
  constructor(props?: AppProps) {
    super({
      outdir: `${Deno.env.get("INIT_CWD")}/dist`,
      yamlOutputType: YamlOutputType.FILE_PER_APP,
      ...props,
    });
  }
}

export function generateArgoCDApps(
  scope: Construct,
  subPath?: string,
  overrides: { [name: string]: ArgoCDApplicationSpec } = {},
) {
  const apps = Deno.readDirSync(Deno.env.get("INIT_CWD")!)
    .filter((d) => d.isDirectory)
    .filter((d) =>
      d.name.substring(0, 1) !== "." && d.name !== "shared" &&
      d.name !== "dist"
    )
    .map((d) => d.name);

  apps.forEach((app) =>
    new ArgoCDApplication(scope, {
      name: app,
      spec: { ...overrides[app], subPath: subPath },
    })
  );
}
