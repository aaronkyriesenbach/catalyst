import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";
import SecretImport from "../shared/SecretImport.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class OCIS extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new SecretImport(this, {
      name: "ocis-user-config",
      fromNamespace: "lldap",
    });

    [
      "machine-auth-api-key",
      "service-account-secret",
      "jwt-secret",
      "storage-system-jwt-secret",
      "transfer-secret",
      "thumbnails-transfer-secret",
    ].map((secret) =>
      new GeneratedPassword(this, {
        name: secret,
        secretTemplate: {
          type: "Opaque",
          stringData: {
            [secret]: "$(value)",
          },
        },
      })
    );

    new GeneratedPassword(this, {
      name: "collaboration-wopi-secret",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          "wopi-secret": "$(value)",
        },
      },
    });

    new GeneratedPassword(this, {
      name: "storage-system-secret",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          "user-id": "727e9485-62b8-4487-bc36-53fc5b374c9a", // This is a random UUID, hardcoded so it will not change on redeploys
          "api-key": "$(value)",
        },
      },
    });

    new IngressRoute(this, {
      name: "ocis",
      service: {
        name: "proxy",
        port: 9200,
      },
    });

    createResourcesFromYaml(this, "ocis-chart.yaml");
  }
}

const app = new Lab53App();
new OCIS(app, "ocis");
app.synth();
