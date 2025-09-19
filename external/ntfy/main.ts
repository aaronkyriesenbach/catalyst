import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import Application from "../../shared/Application.ts";
import { IntOrString } from "../../shared/imports/k8s.ts";
import ConfigPVC from "../../shared/ConfigPVC.ts";

class Ntfy extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const cache = new ConfigPVC(this, {
      name: "ntfy-cache",
    });

    const config = new ConfigPVC(this, {
      name: "ntfy-config",
    });

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
          volumeMounts: [{
            name: cache.name,
            mountPath: "/var/cache/ntfy",
          }, {
            name: config.name,
            mountPath: "/var/lib/ntfy",
          }],
        }],
        volumes: [{
          name: cache.name,
          persistentVolumeClaim: {
            claimName: cache.name,
          },
        }, {
          name: config.name,
          persistentVolumeClaim: {
            claimName: config.name,
          },
        }],
      },
      webPort: 80,
    });
  }
}

const app = new Lab53App();
new Ntfy(app);
app.synth();
