import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Ocis as OCISChart } from "./imports/ocis.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import SecretImport from "../shared/SecretImport.ts";

export class OCIS extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const ldapUserSecret = new SecretImport(this, "ldap-user-secret", {
      name: "ocis-user-secret",
      fromNamespace: "lldap",
    });

    new OCISChart(this, "ocis", {
      namespace: "ocis",
      releaseName: "ocis",
      values: {
        externalDomain: "ocis.lab53.net",
        insecure: {
          oidcIdpInsecure: true,
          ocisHttpApiInsecure: true,
        },
        features: {
          externalUserManagement: {
            enabled: true,
            oidc: {
              issuerURI: "https://auth.lab53.net",
              accessTokenVerifyMethod: "none"
            },
            ldap: {
              writeable: false,
              uri: "ldap://lldap.lldap:3890",
              bindDN: "UID=ocis,OU=people,DC=lab53,DC=net",
              user: {
                baseDN: "OU=people,DC=lab53,DC=net",
              },
            },
          },
        },
        secretRefs: {
          ldapSecretRef: ldapUserSecret.name,
        },
        services: {
          web: {
            config: {
              oidc: {
                additionalValues: {
                  webClientID:
                    "c6206bc285517cb78fd8c827e99205a00747b3be281348ec",
                  loginURL: "https://auth.lab53.net",
                },
              },
            },
          },
        },
      },
    });

    new IngressRoute(this, "ingress", {
      appName: "proxy",
      customHostPrefix: "ocis",
      customPort: 9200,
      useForwardAuth: false,
    });
  }
}

const app = new App();
new OCIS(app, "ocis");
app.synth();
