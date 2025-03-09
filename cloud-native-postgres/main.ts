import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Cloudnativepg } from "./imports/cloudnative-pg.ts";

export class CloudNativePostgres extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new Cloudnativepg(this, "cloudnativepg", {
            namespace: "cnpg-system"
        });
    }
}

const app = new App();
new CloudNativePostgres(app, "cloudnativepostgres");
app.synth();
