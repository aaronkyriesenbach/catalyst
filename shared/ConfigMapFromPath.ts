import { KubeConfigMap } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";
import { readDirSyncRecursive } from "./helpers.ts";
import readTextFileSync = Deno.readTextFileSync;

export default class ConfigMapFromPath extends KubeConfigMap {
  constructor(scope: Construct, props: ConfigMapFromPathProps) {
    const { name, path } = props;

    const files = readDirSyncRecursive(path);

    const data = files.map((
      file,
    ) => [
      file,
      readTextFileSync(file),
    ]);

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      data: Object.fromEntries(data),
    });
  }
}

export type ConfigMapFromPathProps = {
  name: string;
  path: string;
};
