import { App, Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { ArgoCDApplicationSpec } from "./shared/ArgoCDApplication.ts";
import { generateArgoCDApps } from "./shared/helpers.ts";

export class Catalyst extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const overrides: { [name: string]: ArgoCDApplicationSpec } = {
      "cloud-native-postgres": {
        namespace: "cnpg-system",
        serverSideApply: true,
      },
      "calibre-web-automated": {
        namespace: "cwa",
      },
      metallb: {
        namespace: "metallb-system",
        ignoreDifferences: [{
          group: "apiextensions.k8s.io",
          kind: "CustomResourceDefinition",
          name: "bgppeers.metallb.io",
          jsonPointers: ["/spec/conversion/webhook/clientConfig/caBundle"],
        }, {
          group: "apiextensions.k8s.io",
          kind: "CustomResourceDefinition",
          name: "addresspools.metallb.io",
          jsonPointers: ["/spec/conversion/webhook/clientConfig/caBundle"],
        }],
      },
    };

    generateArgoCDApps(this, overrides);
  }
}

const app = new App();
new Catalyst(app, "catalyst");
app.synth();
