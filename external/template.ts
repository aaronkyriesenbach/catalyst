import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../shared/helpers.ts";

class Template extends Chart {
    constructor(scope: Construct) {
        super(scope, crypto.randomUUID());
    }
}

const app = new Lab53App();
new Template(app);
app.synth()