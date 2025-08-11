import Application from "../../shared/Application.ts";
import { Construct } from "npm:constructs";
import ConfigMapFromPath from "../../shared/ConfigMapFromPath.ts";

export default class HardcoverHasura extends Construct {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new ConfigMapFromPath(this, {
      name: "hasura-metadata",
      path: "hasura-metadata",
    });

    new Application(this, {
      name: "hasura",
      podSpecProps: {
        volumes: [{
          name: "metadata",
          configMap: {
            name: "hasura-metadata",
          },
        }],
        containers: [{
          name: "main",
          image:
            "hub.int.lab53.net/hasura/graphql-engine:latest.cli-migrations-v3", // Use of the cli-migrations image allows config ("Metadata" in Hasura-speak) to be applied declaratively from the /hasura-metadata volume mount
          env: [{
            name: "HASURA_GRAPHQL_DATABASE_URL",
            valueFrom: {
              secretKeyRef: {
                name: "postgres-connection-string",
                key: "connection-string",
              },
            },
          }, {
            name: "HASURA_GRAPHQL_METADATA_DATABASE_URL",
            valueFrom: {
              secretKeyRef: {
                name: "postgres-connection-string",
                key: "connection-string",
              },
            },
          }],
          ports: [{
            containerPort: 8080,
          }],
          volumeMounts: [{
            name: "metadata",
            mountPath: "/hasura-metadata",
          }],
        }],
      },
    });
  }
}
