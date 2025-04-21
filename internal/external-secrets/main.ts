import { Lab53App } from "../../shared/helpers.ts";
import { ExternalSecrets } from "../../base/external-secrets/main.ts";

const app = new Lab53App();
new ExternalSecrets(app, "external-secrets-internal");
app.synth();
