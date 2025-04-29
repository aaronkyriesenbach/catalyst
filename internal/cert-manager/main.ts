import { Lab53App } from "../../shared/helpers.ts";
import { CertManager } from "../../base/cert-manager/main.ts";

const app = new Lab53App();
new CertManager(app, "cert-manager-internal", true);
app.synth();
