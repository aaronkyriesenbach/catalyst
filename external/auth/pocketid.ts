import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import Application from "../../shared/Application.ts";
import { makeEnvVars } from "../../shared/helpers.ts";
import GeneratedExternalSecret from "../../shared/external-secrets/GeneratedExternalSecret.ts";
import CNPGCluster from "../../shared/CNPGCluster.ts";

export class PocketID extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const dbCreds = new GeneratedExternalSecret(this, {
      name: "pocketid-db-creds",
      fieldsToGenerate: ["password"],
      extraData: {
        username: "pocketid",
        connectionString:
          "postgresql://pocketid:{{ .password }}@pocketid-cluster-rw:5432/pocketid",
      },
    });

    new CNPGCluster(this, {
      appName: "pocketid",
      secretName: dbCreds.name,
    });

    const secretKey = new GeneratedExternalSecret(this, {
      name: "pocketid-secrets",
      fieldsToGenerate: ["encryption_key"],
    });

    new Application(this, {
      name: "pocketid",
      podSpecProps: {
        securityContext: undefined,
        containers: [
          {
            name: "main",
            image: "ghcr.int.lab53.net/pocket-id/pocket-id:v1-distroless",
            env: makeEnvVars({
              APP_URL: "https://auth.lab53.net",
              TRUST_PROXY: "true",
              DB_PROVIDER: "postgres",
              DB_CONNECTION_STRING: {
                secretKeyRef: {
                  name: dbCreds.name,
                  key: "connectionString",
                },
              },
              KEYS_STORAGE: "database",
              ENCRYPTION_KEY: {
                secretKeyRef: {
                  name: secretKey.name,
                  key: "encryption_key",
                },
              },
              UI_CONFIG_DISABLED: "true",
              LDAP_ENABLED: "true",
              LDAP_URL: "ldap://lldap:3890",
              LDAP_BIND_DN: "cn=pocketid,ou=people,dc=lab53,dc=net",
              LDAP_BASE: "dc=lab53,dc=net",
              LDAP_SKIP_CERT_VERIFY: "true",
              LDAP_BIND_PASSWORD: {
                secretKeyRef: {
                  name: "lldap-users",
                  key: "pocketid_password",
                },
              },
            }),
            ports: [{ containerPort: 1411 }],
          },
        ],
      },
      webPort: 1411,
      ingressRouteSpec: {
        customHostnamePrefix: "auth",
      },
    });
  }
}
