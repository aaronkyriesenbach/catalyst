import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { makeEnvVars } from "../../shared/helpers.ts";
import GeneratedExternalSecret from "../../shared/external-secrets/GeneratedExternalSecret.ts";
import Application from "../../shared/Application.ts";
import { User } from "./user.ts";
import ConfigMap from "../../shared/k8s/ConfigMap.ts";

export class LLDAP extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const image = "hub.int.lab53.net/lldap/lldap:2025-08-21";

    const lldapSecrets = new GeneratedExternalSecret(this, {
      name: "lldap-secrets",
      fieldsToGenerate: ["jwtsecret", "keyseed"],
    });

    const adminCreds = new GeneratedExternalSecret(this, {
      name: "lldap-admin-creds",
      fieldsToGenerate: ["password"],
    });

    const users: { [id: string]: User } = {
      aaron: {
        email: "aaron@lab53.net",
        firstName: "Aaron",
        lastName: "Ky-Riesenbach",
        groups: ["admins", "users"],
      },
    };

    const serviceAccounts = ["pocketid"];

    const allUsers = [...serviceAccounts, ...Object.keys(users)];

    const userConfig = new GeneratedExternalSecret(this, {
      name: "lldap-users",
      fieldsToGenerate: allUsers.map((username) => `${username}_password`),
      extraData: {
        ...Object.fromEntries(
          Object.keys(users).map((u) => [
            `${u}.json`,
            JSON.stringify({
              id: u,
              password: "{{ ." + u + "_password }}",
              ...users[u],
            }),
          ]),
        ),
        ...Object.fromEntries(
          serviceAccounts.map((sa) => [
            `${sa}.json`,
            JSON.stringify({
              id: sa,
              email: `${sa}@lab53.net`,
              password: "{{ ." + sa + "_password }}",
              groups: ["serviceAccounts"],
            }),
          ]),
        ),
      },
    });

    const groupConfig = new ConfigMap(this, {
      name: "lldap-groups",
      data: {
        "groups.json":
          '{ "name": "users" }\n{ "name": "admins" }\n{ "name": "serviceAccounts" }\n',
      },
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
                containerPort: 3890,
                name: "ldap",
              },
              {
                containerPort: 17170,
                name: "web",
              },
            ],
          },
        ],
        initContainers: [
          {
            name: "bootstrap",
            image: image,
            command: ["/bin/bash", "-c", "/app/bootstrap.sh && sleep infinity"], // This cannot be run as an init container because the main container needs to be up
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
              {
                name: groupConfig.name,
                mountPath: "/bootstrap/group-configs",
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
          {
            name: groupConfig.name,
            configMap: {
              name: groupConfig.name,
            },
          },
        ],
      },
    });
  }
}
