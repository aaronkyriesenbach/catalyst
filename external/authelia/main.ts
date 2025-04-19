import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import CNPGCluster from "../../shared/CNPGCluster.ts";
import GeneratedPassword from "../../shared/GeneratedPassword.ts";
import { createResourcesFromYaml, Lab53App } from "../../shared/helpers.ts";
import GeneratedRSAKeypair from "../../shared/GeneratedRSAKeypair.ts";
import SecretImport from "../../shared/SecretImport.ts";

export class Authelia extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "authelia" });

    new GeneratedRSAKeypair(this, "oidc-jwk-keypair");

    new SecretImport(this, { name: "admin-pass", fromNamespace: "lldap" });

    ["storage-encryption-key", "session-encryption-key", "jwt-hmac-secret", "oidc-hmac-secret"].map((name) =>
      new GeneratedPassword(this, { name: name })
    );

    new GeneratedPassword(this, {
      name: "postgres-creds",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          username: "authelia",
          password: "$(value)",
        },
      },
    });

    new GeneratedPassword(this, {
      name: "redis-password",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          "redis-password": "$(value)",
        },
      },
    });

    new CNPGCluster(this, "cluster", {
      appName: "authelia",
      passwordSecret: {
        name: "postgres-creds",
        key: "password",
      },
    });

    createResourcesFromYaml(this, "redis-chart.yaml", true);
    createResourcesFromYaml(this, "authelia-chart.yaml");
  }
}

const app = new Lab53App();
new Authelia(app, "authelia");
app.synth();
