import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { KubeNamespace } from "../shared/imports/k8s.ts";
import { Lab53App } from "../shared/helpers.ts";
import TransmissionApp from "./TransmissionApp.ts";

export class Transmission extends Chart {
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

    new TransmissionApp(this, {
      name: "writer",
      protonSecretName: "proton-openvpn-creds",
      downloadSubpath: "downloads",
    });

    new TransmissionApp(this, {
      name: "reader",
      protonSecretName: "proton-openvpn-creds",
      downloadSubpath: "downloads/reader",
      postStartHook: {
        exec: {
          command: ["/bin/sh", "/etc/openvpn/custom/update-seedbox.sh"],
        },
      },
    });
  }
}

const app = new Lab53App();
new Transmission(app, "transmission");
app.synth();
