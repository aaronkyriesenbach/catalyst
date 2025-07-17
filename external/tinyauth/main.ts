import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import GeneratedBasicAuthSecret from "../../shared/mittwald-secret-gen/GeneratedBasicAuthSecret.ts";
import Application from "../../shared/Application.ts";
import GeneratedSecret from "../../shared/mittwald-secret-gen/GeneratedSecret.ts";
import { IntOrString } from "../../shared/imports/k8s.ts";
import { Middleware } from "../../shared/imports/middleware-traefik.io.ts";

class TinyAuth extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const secret = new GeneratedSecret(this, {
      name: "secret",
      fieldsToGenerate: ["secret"],
      length: 32,
    });

    const creds = new GeneratedBasicAuthSecret(this, {
      name: "tinyauth-creds",
    });

    new Application(this, {
      name: "tinyauth",
      podSpecProps: {
        containers: [{
          name: "tinyauth",
          image: "ghcr.int.lab53.net/steveiliop56/tinyauth:v3",
          ports: [{ containerPort: 3000 }],
          env: [{
            name: "APP_URL",
            value: "https://auth.lab53.net",
          }, {
            name: "SECRET",
            valueFrom: {
              secretKeyRef: {
                name: secret.name,
                key: "secret",
              },
            },
          }, {
            name: "USERS",
            valueFrom: {
              secretKeyRef: {
                name: creds.name,
                key: "auth",
              },
            },
          }, {
            name: "DISABLE_CONTINUE",
            value: "true"
          }],
          livenessProbe: {
            httpGet: {
              path: "/api/healthcheck",
              port: IntOrString.fromNumber(3000),
            },
          },
          readinessProbe: {
            httpGet: {
              path: "/api/healthcheck",
              port: IntOrString.fromNumber(3000),
            },
          },
        }],
      },
      webPort: 3000,
      ingressRouteSpec: {
        customHostname: "auth",
      },
    });

    new Middleware(this, crypto.randomUUID(), {
      metadata: {
        name: "tinyauth",
      },
      spec: {
        forwardAuth: {
          address: "http://tinyauth.tinyauth:3000/api/auth/traefik",
        },
      },
    });
  }
}

const app = new Lab53App();
new TinyAuth(app);
app.synth();
