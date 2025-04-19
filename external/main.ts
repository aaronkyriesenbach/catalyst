import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { ArgoCDApplicationSpec } from "../shared/ArgoCDApplication.ts";
import { generateArgoCDApps, Lab53App } from "../shared/helpers.ts";

export class CatalystExternal extends Chart {
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
    };

    generateArgoCDApps(this, "external", overrides);
  }
}

const app = new Lab53App();
new CatalystExternal(app, "catalyst-external");
app.synth();
