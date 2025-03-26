import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import ConfigPVC from "../shared/ConfigPVC.ts";
import { KubeNamespace } from "../shared/imports/k8s.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { Lab53App, readTextFileSync } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";
import { getTransmissionPodSpec } from "./constants.ts";
import { Reader } from "./reader.ts";
import { PodSpecProps } from "../shared/Pod.ts";

export class Writer extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "transmission" });

    new KubeNamespace(this, "namespace", {
      metadata: {
        name: "transmission",
        labels: {
          "pod-security.kubernetes.io/enforce": "privileged",
        },
      },
    });

    const writerConfig = new ConfigPVC(this, { name: "writer-config" });
    const writerGluetunConfig = new GeneratedPassword(
      this,
      {
        name: "writer-gluetun-config",
        secretTemplate: {
          type: "Opaque",
          stringData: {
            "config.toml": readTextFileSync("gluetun-role-config.toml"),
            key: "$(value)",
          },
        },
      },
    );

    const baseWriterSpec = getTransmissionPodSpec(
      writerConfig.name,
      writerGluetunConfig.name,
    );

    const writerPodSpec: PodSpecProps = {
      ...baseWriterSpec,
      nasVolumeMounts: {
        transmission: [{
          mountPath: "/downloads",
          subPath: "downloads"
        }]
      }
    }

    new Application(this, {
      name: "writer",
      podSpecProps: writerPodSpec,
      webPort: 9091,
      ingressRouteSpec: {
        useInsecureTransport: true,
      },
    });
  }
}

const app = new Lab53App();
new Writer(app, "writer");
new Reader(app, "reader");
app.synth();
