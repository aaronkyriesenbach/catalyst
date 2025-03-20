import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import ConfigMap from "../shared/ConfigMap.ts";
import { AppProps } from "../shared/AppProps.ts";
import Deployment from "../shared/Deployment.ts";

export class DynamicDNS extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const cm = new ConfigMap(this, "cm", {
      name: "script",
      data: {
        "update-dns.sh": Deno.readTextFileSync("update-dns.sh"),
      },
    });

    const deploymentSpec: AppProps = {
      appName: "dynamic-dns",
      volumes: [{
        name: cm.name,
        configMap: {
          name: cm.name,
          defaultMode: 0o755
        },
      }],
      containers: [{
        name: "script-runner",
        image: "alpine/curl:8.12.1",
        command: ["/mnt/update-dns.sh"],
        volumeMounts: [{
          name: cm.name,
          mountPath: "/mnt/update-dns.sh",
          subPath: "update-dns.sh"
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
    };

    new Deployment(this, "deployment", deploymentSpec);
  }
}

const app = new App();
new DynamicDNS(app, "dynamicdns");
app.synth();
