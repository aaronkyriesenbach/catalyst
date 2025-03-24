import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Authelia as AutheliaChart } from "./imports/authelia.ts";
import { RsaKey } from "./imports/secretgen.k14s.io.ts";
import { SecretImport } from "./imports/secretgen.carvel.dev.ts";
import CNPGCluster from "../shared/CNPGCluster.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { Redis } from "./imports/redis.ts";

export class Authelia extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const jwkKeypair = new RsaKey(this, "jwk-keypair", {
      metadata: {
        name: "oidc-jwk-keypair",
      },
      spec: {},
    });

    const adminPassSecret = new SecretImport(this, "lldap-import", {
      metadata: {
        name: "admin-pass",
      },
      spec: {
        fromNamespace: "lldap",
      },
    });

    const storageEncryptionKey = new GeneratedPassword(
      this,
      "storage-encryption-key",
      {
        name: "storage-encryption-key",
      },
    );

    const sessionEncryptionKey = new GeneratedPassword(
      this,
      "session-encryption-key",
      {
        name: "session-encryption-key",
      },
    );

    const postgresCreds = new GeneratedPassword(this, "postgresuser", {
      name: "postgres-creds",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          username: "authelia",
          password: "$(value)",
        },
      },
    });

    const redisPassword = new GeneratedPassword(this, "redispassword", {
      name: "redis-password",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          "redis-password": "$(value)",
        },
      },
    });

    new Redis(this, "redis", {
      releaseName: "redis",
      namespace: "authelia",
      values: {
        resourcesPreset: "micro",
        auth: {
          existingSecret: redisPassword.name,
        },
        sentinel: {
          enabled: true,
        },
      },
    });

    new CNPGCluster(this, "cluster", {
      appName: "authelia",
      passwordSecret: {
        name: postgresCreds.name,
        key: "password",
      },
    });

    new AutheliaChart(this, "chart", {
      namespace: "authelia",
      releaseName: "authelia",
      values: {
        ingress: {
          enabled: true,
          tls: {
            enabled: true,
          },
          traefikCRD: {
            enabled: true,
            entryPoints: ["websecure"],
            tls: {
              certResolver: "letsencrypt",
            },
          },
        },
        secret: {
          additionalSecrets: {
            [adminPassSecret.name]: {
              items: [{
                key: "password",
                path: "lldap-admin-password",
              }],
            },
            [jwkKeypair.name]: {
              items: [{
                key: "key.pem",
                path: "oidc-private-key",
              }],
            },
            [sessionEncryptionKey.name]: {
              items: [{
                key: "password",
                path: "encryption-key",
              }],
            },
            [storageEncryptionKey.name]: {
              items: [{
                key: "password",
                path: "encryption-key",
              }],
            },
            [postgresCreds.name]: {
              items: [{
                key: "password",
                path: "postgres-password",
              }],
            },
            [redisPassword.name]: {
              items: [{
                key: "redis-password",
                path: "redis-password",
              }],
            },
          },
        },
        configMap: {
          theme: "dark",
          authentication_backend: {
            ldap: {
              enabled: true,
              implementation: "lldap",
              address: "ldap://lldap.lldap:3890",
              base_dn: "DC=lab53,DC=net",
              additional_users_dn: "OU=people",
              user: "UID=admin,OU=people,DC=lab53,DC=net",
              password: {
                secret_name: "admin-pass",
                path: "lldap-admin-password",
              },
            },
          },
          session: {
            encryption_key: {
              secret_name: sessionEncryptionKey.name,
              path: "encryption-key",
            },
            cookies: [{
              subdomain: "auth",
              domain: "lab53.net",
            }],
            redis: {
              enabled: true,
              host: "redis",
              password: {
                secret_name: redisPassword.name,
                path: "redis-password",
              },
            },
          },
          storage: {
            encryption_key: {
              secret_name: storageEncryptionKey.name,
              path: "encryption-key",
            },
            postgres: {
              enabled: true,
              address: "tcp://authelia-cluster-rw:5432",
              password: {
                secret_name: postgresCreds.name,
                path: "postgres-password",
              },
            },
          },
          access_control: {
            rules: [{
              domain: "*.lab53.net",
              policy: "two_factor",
            }],
          },
          default_2fa_method: "totp",
          notifier: {
            filesystem: {
              enabled: true,
            },
          },
          identity_providers: {
            oidc: {
              enabled: true,
              jwks: [{
                key: {
                  path: "/secrets/oidc-jwk-keypair/oidc-private-key",
                },
              }],
              clients: [{
                client_id: "tailscale",
                client_name: "Tailscale SSO",
                client_secret:
                  "$pbkdf2-sha512$310000$RM0fzKMw38RxttTvALU3Tw$mWgP4QVLbQieihN99TfL8utB7VOpFof1Xfd70AoNBqlPlmxsTie9Xu53kyP/DQWMW3tZFXtZn57kKnzfW41YiQ",
                redirect_uris: ["https://login.tailscale.com/a/oauth_response"],
                scopes: ["openid", "email", "profile"],
              }, {
                client_id: "c6206bc285517cb78fd8c827e99205a00747b3be281348ec",
                client_name: "ownCloud Infinite Scale",
                client_secret: "$pbkdf2-sha512$310000$yqBE734t.arH5qCEfsT3Jw$aYcuStJ8zaNCNVtEu9YIiTfCHCEiZMFORPqu1eL48ErGkNlqqeHpDOlUhUaPOoNMs.PdGPS1AF4.Ich6qnOgYg",
                redirect_uris: [
                  "https://ocis.lab53.net",
                  "https://ocis.lab53.net/oidc-callback.html",
                  "https://ocis.lab53.net/oidc-silent-redirect.html",
                ],
                scopes: ["openid", "email", "profile"],
              }],
            },
          },
        },
      },
    });
  }
}

const app = new App();
new Authelia(app, "authelia");
app.synth();
