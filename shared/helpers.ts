import { ApiObject, App, AppProps, YamlOutputType } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { parseAllDocuments } from "jsr:@eemeli/yaml";
import * as path from "jsr:@std/path";
import { Container, VolumeMount } from "./imports/k8s.ts";
import { NasVolumeMount, NasVolumeMountMap } from "./k8s/Pod.ts";
import { NAS_VOLUME_NAME } from "./constants.ts";
import { ArgoCDApplication, ArgoCDApplicationSpec } from "./argocd/ArgoCDApplication.ts";

export function readTextFileFromInitCwd(filename: string) {
  return Deno.readTextFileSync(
    path.resolve(Deno.env.get("INIT_CWD")!, filename),
  );
}

export function readTextFileFromSharedDir(filename: string) {
  return Deno.readTextFileSync(new URL(filename, import.meta.url));
}

export function createResourcesFromYaml(
  scope: Construct,
  filename: string,
  options?: CreateResourceFromYamlOptions,
): ApiObject[] {
  const { useYaml11, readFromShared } = options ?? {};
  const resourceYaml = readFromShared
    ? readTextFileFromSharedDir(filename)
    : readTextFileFromInitCwd(filename);

  const resources = parseAllDocuments(
    resourceYaml,
    useYaml11 ? { version: "1.1" } : undefined,
  );

  const objects: ApiObject[] = [];
  resources.forEach((r) => {
    try {
      const o = new ApiObject(scope, crypto.randomUUID(), r.toJS());
      objects.push(o);
    } catch (err) {
      console.log(r.toJS());
      throw err;
    }
  });

  return objects;
}

export type CreateResourceFromYamlOptions = {
  useYaml11?: boolean;
  readFromShared?: boolean;
};

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
  overrides: { [name: string]: ArgoCDApplicationSpec },
) {
  const apps = Deno.readDirSync(".")
    .filter((d) => d.isDirectory)
    .filter((d) =>
      d.name.substring(0, 1) !== "." && d.name !== "shared" &&
      d.name !== "dist"
    )
    .map((d) => d.name);

  apps.forEach((app) =>
    new ArgoCDApplication(scope, { name: app, spec: overrides[app] })
  );
}
