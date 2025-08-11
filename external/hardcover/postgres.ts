import { Construct } from "npm:constructs";
import PostgresService from "../../shared/PostgresService.ts";
import { SecretTemplate } from "../../shared/imports/secretgen.carvel.dev.ts";
import { KubeRole, KubeRoleBinding, KubeServiceAccount } from "../../shared/imports/k8s.ts";

export default class HardcoverPostgres extends Construct {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new PostgresService(this, {
      name: "postgres",
      username: "hardcover",
      secretKey: "password",
      nasMountPath: "cluster/hardcover/postgres",
    });

    new KubeServiceAccount(this, crypto.randomUUID(), {
      metadata: {
        name: "input-resource-reader",
      },
    });

    new KubeRole(this, crypto.randomUUID(), {
      metadata: {
        name: "secret-reader",
      },
      rules: [{
        apiGroups: [""],
        resources: ["secrets"],
        verbs: ["get"],
      }],
    });

    new KubeRoleBinding(this, crypto.randomUUID(), {
      metadata: {
        name: "secret-reader-binding",
      },
      subjects: [{
        kind: "ServiceAccount",
        name: "input-resource-reader",
      }],
      roleRef: {
        kind: "Role",
        name: "secret-reader",
        apiGroup: "rbac.authorization.k8s.io",
      },
    });

    new SecretTemplate(this, crypto.randomUUID(), {
      metadata: {
        name: "postgres-connection-string",
      },
      spec: {
        serviceAccountName: "input-resource-reader",
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
              "postgres://hardcover:$(.secret.data.password)@postgres:5432/hardcover",
          },
        },
      },
    });
  }
}
