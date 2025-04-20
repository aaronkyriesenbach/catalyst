import { Linkerd } from "../../shared/linkerd/main.ts";
import { Lab53App } from "../../shared/helpers.ts";

const app = new Lab53App();
new Linkerd(app, "linkerd-external");
app.synth();
