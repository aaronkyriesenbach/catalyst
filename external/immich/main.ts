import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";
import { stringify } from "npm:yaml@2.7.1";

class Immich extends Chart {
    constructor(scope: Construct) {
        super(scope, crypto.randomUUID())

        new HelmChart(this, {
            name: "immich",
            repo: "oci://ghcr.io/immich-app/immich-charts/immich",
            values: stringify({
                image: {
                    tag: "v1.138.1"
                }
            })
        })
    }
}

const app = new Lab53App()
new Immich(app);
app.synth()