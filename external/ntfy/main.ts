import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import Application from "../../shared/Application.ts";
import { IntOrString } from "../../shared/imports/k8s.ts";

class Ntfy extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new Application(this, {
      name: "ntfy",
      podSpecProps: {
        containers: [{
          name: "ntfy",
          image: "hub.int.lab53.net/binwiederhier/ntfy:latest",
          args: ["serve"],
          ports: [{ containerPort: 80 }],
          readinessProbe: {
            httpGet: {
              path: "/v1/health",
              port: IntOrString.fromNumber(80),
            },
          },
          env: [{
            name: "NTFY_BASE_URL",
            value: "https://ntfy.lab53.net",
          }, {
            name: "NTFY_AUTH_FILE",
            value: "/var/lib/ntfy/user.db",
          }, {
            name: "NTFY_AUTH_DEFAULT_ACCESS",
            value: "read-only",
          }, {
            name: "NTFY_UPSTREAM_BASE_URL",
            value: "https://ntfy.sh",
          }],
        }],
        nasVolumeMounts: {
          ntfy: [{
            mountPath: "/var/cache/ntfy",
            subPath: "ntfy/cache",
          }, {
            mountPath: "/var/lib/ntfy",
            subPath: "ntfy/config",
          }],
        },
      },
      webPort: 80,
    });
  }
}

const app = new Lab53App();
new Ntfy(app);
app.synth();
