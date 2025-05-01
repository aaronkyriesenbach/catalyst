import { Lab53App } from "../../shared/helpers.ts";
import { CertManager as CertManagerBase } from "../../base/cert-manager/main.ts";
import { Construct } from "npm:constructs";
import ExternalSecret from "../../shared/external-secrets/ExternalSecret.ts";

class CertManager extends CertManagerBase {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new ExternalSecret(this, {
      name: "aws-creds",
      externalSecretRef: {
        key: "lab53/internal/route53_dns_challenge",
      },
    });
  }
}

const app = new Lab53App();
new CertManager(app, "cert-manager-internal");
app.synth();
