import { Construct } from "npm:constructs";
import Deployment from "./k8s/Deployment.ts";
import { SecretKeySelector } from "./imports/k8s.ts";
import GeneratedSecret from "./mittwald-secret-gen/GeneratedSecret.ts";
import Service from "./k8s/Service.ts";

export default class PostgresService extends Construct {
  constructor(scope: Construct, props: PostgresServiceProps) {
    super(scope, crypto.randomUUID());

    const {
      name,
      tag = "17",
      nasMountPath,
      username = "postgres",
      dbName,
      existingSecretSelector,
      secretName,
      secretKey,
    } = props;

    if (!existingSecretSelector) {
      new GeneratedSecret(this, {
        name: secretName ?? `${name}-secret`,
        fieldsToGenerate: [secretKey ?? "secret"],
      });
    }

    new Deployment(this, {
      name: name,
      podSpecProps: {
        containers: [{
          name: "main",
          image: `hub.int.lab53.net/library/postgres:${tag}`,
          env: [{
            name: "POSTGRES_PASSWORD",
            valueFrom: {
              secretKeyRef: existingSecretSelector ?? {
                name: secretName ?? `${name}-secret`,
                key: secretKey ?? "secret",
              },
            },
          }, {
            name: "POSTGRES_USER",
            value: username,
          }, {
            name: "POSTGRES_DB",
            value: dbName ?? username,
          }],
          ports: [{
            containerPort: 5432,
          }],
        }],
        nasVolumeMounts: nasMountPath
          ? {
            main: [{
              mountPath: "/var/lib/postgresql/data",
              subPath: nasMountPath,
            }],
          }
          : undefined,
      },
    });

    new Service(this, {
      name: name,
      serviceSpec: {
        ports: [{
          port: 5432,
        }],
        selector: {
          app: name,
        },
      },
    });
  }
}

type PostgresServiceProps = {
  name: string;
  tag?: string;
  nasMountPath?: string;
  username?: string;
  dbName?: string;
  existingSecretSelector?: SecretKeySelector;
  secretName?: string;
  secretKey?: string;
};
