import { Construct } from "npm:constructs";
import PostgresService from "../../shared/PostgresService.ts";
import { SecretTemplate } from "../../shared/imports/secretgen.carvel.dev.ts";

export default class HardcoverPostgres extends Construct {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new PostgresService(this, {
      name: "postgres",
      username: "hardcover",
      secretKey: "password",
      nasMountPath: "cluster/hardcover/postgres",
    });

    new SecretTemplate(this, crypto.randomUUID(), {
      metadata: {
        name: "postgres-connection-string",
      },
      spec: {
        inputResources: [{
          name: "secret",
          ref: {
            apiVersion: "v1",
            kind: "Secret",
            name: "postgres-secret",
          },
        }],
        template: {
          type: "Opaque",
          data: {
            "connection-string":
              "postgres://hardcover:$(.postgres-secret.data.password)@postgres:5432/hardcover",
          },
        },
      },
    });
  }
}
