import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { makeEnvVars } from "../../shared/helpers.ts";
import GeneratedExternalSecret from "../../shared/external-secrets/GeneratedExternalSecret.ts";
import Application from "../../shared/Application.ts";

export class LLDAP extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const image = "hub.int.lab53.net/lldap/lldap:2025-08-21";
    const usersToCreate = ["aaron", "pocketid"];

    const lldapSecrets = new GeneratedExternalSecret(this, {
      name: "lldap-secrets",
      fieldsToGenerate: ["jwtsecret", "keyseed"],
    });

    const adminCreds = new GeneratedExternalSecret(this, {
      name: "lldap-admin-creds",
      fieldsToGenerate: ["password"],
    });

    const userConfig = new GeneratedExternalSecret(this, {
      name: "lldap-users",
      fieldsToGenerate: usersToCreate.map((username) => `${username}_password`),
      extraData: Object.fromEntries(
        usersToCreate.map((u) => [
          `${u}.json`,
          JSON.stringify({
            id: u,
            email: `${u}@lab53.net`,
            password: "{{ ." + u + "_password }}",
          }),
        ]),
      ),
    });

    new Application(this, {
      name: "lldap",
      podSpecProps: {
        securityContext: undefined,
        containers: [
          {
            name: "main",
            image: image,
            env: makeEnvVars({
              UID: "1000",
              GID: "1000",
              TZ: "America/New_York",
              LLDAP_JWT_SECRET: {
                secretKeyRef: {
                  name: lldapSecrets.name,
                  key: "jwtsecret",
                },
              },
              LLDAP_KEY_SEED: {
                secretKeyRef: {
                  name: lldapSecrets.name,
                  key: "keyseed",
                },
              },
              LLDAP_LDAP_BASE_DN: "dc=lab53,dc=net",
              LLDAP_LDAP_USER_PASS: {
                secretKeyRef: {
                  name: adminCreds.name,
                  key: "password",
                },
              },
            }),
            ports: [
              {
                containerPort: 17170,
              },
            ],
          },
        ],
        initContainers: [
          {
            name: "bootstrap",
            image: image,
            command: ["/app/bootstrap.sh"],
            restartPolicy: "Always",
            env: makeEnvVars({
              LLDAP_ADMIN_PASSWORD: {
                secretKeyRef: {
                  name: adminCreds.name,
                  key: "password",
                },
              },
              DO_CLEANUP: "true",
            }),
            volumeMounts: [
              {
                name: userConfig.name,
                mountPath: "/bootstrap/user-configs",
              },
            ],
          },
        ],
        volumes: [
          {
            name: userConfig.name,
            secret: {
              secretName: userConfig.name,
            },
          },
        ],
      },
    });
  }
}
