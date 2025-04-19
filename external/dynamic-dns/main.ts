import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import ConfigMap from "../../shared/ConfigMap.ts";
import Deployment from "../../shared/Deployment.ts";
import { Lab53App, readTextFileSync } from "../../shared/helpers.ts";

export class DynamicDNS extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cm = new ConfigMap(this, {
      name: "update-dns-script",
      data: {
        "update-dns.sh": readTextFileSync("update-dns.sh"),
      },
    });

    new Deployment(this, {
      name: "dynamic-dns",
      podSpecProps: {
        volumes: [{
          name: cm.name,
          configMap: {
            name: cm.name,
            defaultMode: 0o755,
          },
        }],
        containers: [{
          name: "script-runner",
          image: "alpine/curl:8.12.1",
          command: ["/mnt/update-dns.sh"],
          volumeMounts: [{
            name: cm.name,
            mountPath: "/mnt/update-dns.sh",
            subPath: "update-dns.sh",
          }],
          env: [{
            name: "SHARED_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: "ddns-shared-secret",
                key: "secret",
              },
            },
          }],
        }],
      },
    });
  }
}

const app = new Lab53App();
new DynamicDNS(app, "dynamicdns");
app.synth();
