import { Construct } from "npm:constructs";
import { Chart, JsonPatch } from "npm:cdk8s";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";

export class LocalPathProvisioner extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const resources = createResourcesFromYaml(
      this,
      "local-path-storage-v0.0.31.yaml",
    );

    const config = resources.find((o) =>
      o.kind === "ConfigMap" && o.name === "local-path-config"
    )!;
    const configFile = config.toJson().data["config.json"];
    const updatedConfigFile = configFile.replace(
      "/opt/local-path-provisioner",
      "/var/local-path-provisioner",
    ); // var must be used here because only var is persisted on Talos Linux machines

    config.addJsonPatch(
      JsonPatch.replace("/data/config.json", updatedConfigFile),
    );

    const sc = resources.find((o) =>
      o.kind === "StorageClass" && o.name === "local-path"
    )!;
    sc.addJsonPatch(
      JsonPatch.add("/metadata/annotations", {
        "storageclass.kubernetes.io/is-default-class": "true",
      }),
    );

    const ns = resources.find((o) =>
      o.kind === "Namespace" && o.name === "local-path-storage"
    )!;
    ns.addJsonPatch(
      JsonPatch.add("/metadata/labels", {
        "pod-security.kubernetes.io/enforce": "privileged",
      }),
    );
  }
}

const app = new Lab53App();
new LocalPathProvisioner(app, "local-path-provisioner");
app.synth();
