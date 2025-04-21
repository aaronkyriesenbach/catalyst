import { Lab53App } from "../../shared/helpers.ts";
import { Reloader } from "../../shared/reloader/main.ts";

const app = new Lab53App();
new Reloader(app, "reloader");
app.synth();
