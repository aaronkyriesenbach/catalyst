import { App, AppProps, YamlOutputType } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import * as path from "jsr:@std/path";
import { Container, EnvVar, EnvVarSource, VolumeMount } from "./imports/k8s.ts";
import { NasVolumeMount, NasVolumeMountMap } from "./k8s/Pod.ts";
import { NAS_VOLUME_NAME } from "./constants.ts";
import {
  ArgoCDApplication,
  ArgoCDApplicationSpec,
} from "./argocd/ArgoCDApplication.ts";

export function readTextFile(filename: string) {
  return Deno.readTextFileSync(
    path.resolve(Deno.env.get("INIT_CWD")!, filename),
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

  const nonInjectedContainers = containers.filter(
    (c) => !containersToInject.includes(c.name),
  );

  const injectedContainers: Container[] = containers
    .filter((c) => containersToInject.includes(c.name))
    .map((c) => ({
      ...c,
      volumeMounts: [
        ...(nasVolumeMounts[c.name].map((vm) =>
          getInjectedVolumeMount(vm),
        ) as VolumeMount[]),
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
  subPath: string,
  overrides?: { [name: string]: ArgoCDApplicationSpec },
) {
  const apps = Deno.readDirSync(Deno.env.get("INIT_CWD")!)
    .filter((d) => d.isDirectory)
    .filter(
      (d) =>
        d.name.substring(0, 1) !== "." &&
        d.name !== "shared" &&
        d.name !== "bootstrap" &&
        d.name !== "dist",
    )
    .map((d) => d.name);

  apps.forEach(
    (app) =>
      new ArgoCDApplication(scope, {
        name: app,
        subPath: subPath,
        spec: (overrides ?? {})[app],
      }),
  );
}

// Path is relative to call site
export function readDirSyncRecursive(path: string): string[] {
  const results: string[] = [];

  const searchPath =
    path.substring(0, 1) === "/"
      ? path
      : `${Deno.env.get("INIT_CWD")!}/${path}`;

  for (const dirEntry of Deno.readDirSync(searchPath)) {
    if (dirEntry.isDirectory) {
      results.push(...readDirSyncRecursive(`${searchPath}/${dirEntry.name}`));
    } else {
      results.push(`${searchPath}/${dirEntry.name}`);
    }
  }

  return results;
}

export function makeEnvVars(obj: {
  [key: string]: string | EnvVarSource;
}): EnvVar[] {
  return Object.entries(obj).map(([key, value]) =>
    typeof value === "string"
      ? { name: key, value: value }
      : {
          name: key,
          valueFrom: value,
        },
  );
}
