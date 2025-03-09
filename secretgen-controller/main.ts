import { Construct } from "npm:constructs";
import { App, Chart, Include } from "npm:cdk8s";

export class SecretgenController extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new Include(this, "secretgen-controller", {
            url: "https://github.com/carvel-dev/secretgen-controller/releases/latest/download/release.yml"
        });
    }
}

const app = new App();
new SecretgenController(app, "secretgen-controller");
app.synth();
