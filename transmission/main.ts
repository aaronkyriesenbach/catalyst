import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import ConfigPVC from "../shared/ConfigPVC.ts";
import { KubeNamespace } from "../shared/imports/k8s.ts";
import { Lab53App, readTextFileSync } from "../shared/helpers.ts";
import Application from "../shared/Application.ts";
// import { Reader } from "./reader.ts";
import ConfigMap from "../shared/ConfigMap.ts";
import { getTransmissionPodSpec } from "./constants.ts";

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
    new ConfigMap(this, {
      name: "port-forward-script",
      data: {
        "update-port.sh": readTextFileSync("update-port.sh"),
      },
    });

    new Application(this, {
      name: "writer",
      podSpecProps: getTransmissionPodSpec(
        writerConfig.name,
        "proton-openvpn-creds",
      ),
      webPort: 9091,
      ingressRouteSpec: {
        useInsecureTransport: true,
      },
    });
  }
}

const app = new Lab53App();
new Writer(app, "writer");
// new Reader(app, "reader");
app.synth();
