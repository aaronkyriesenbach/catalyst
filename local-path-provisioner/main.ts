import { Construct } from "npm:constructs";
import { App, Chart, Include, JsonPatch } from "npm:cdk8s";

export class LocalPathProvisioner extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const lpp = new Include(this, "local-path-provisioner", {
            url: "https://raw.githubusercontent.com/rancher/local-path-provisioner/v0.0.31/deploy/local-path-storage.yaml"
        });

        const config = lpp.apiObjects.find(o => o.kind === "ConfigMap" && o.name === "local-path-config");
        const configFile = config.props.data["config.json"];
        const updatedConfigFile = configFile.replace("/opt/local-path-provisioner", "/var/local-path-provisioner"); // var must be used here because only var is persisted on Talos Linux machines

        config.addJsonPatch(JsonPatch.replace("/data/config.json", updatedConfigFile));

        const sc = lpp.apiObjects.find(o => o.kind === "StorageClass" && o.name === "local-path");
        sc.addJsonPatch(JsonPatch.add("/metadata/annotations", { "storageclass.kubernetes.io/is-default-class": "true" }));

        const ns = lpp.apiObjects.find(o => o.kind === "Namespace" && o.name === "local-path-storage");
        ns.addJsonPatch(JsonPatch.add("/metadata/labels", { "pod-security.kubernetes.io/enforce": "privileged" }));
    }
}

const app = new App();
new LocalPathProvisioner(app, "local-path-provisioner");
app.synth();
