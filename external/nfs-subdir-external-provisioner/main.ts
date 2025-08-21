import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";
import { stringify } from "npm:yaml@2.7.1";

class NFSSubdirExternalProvisioner extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "nfs-subdir-external-provisioner",
      repo:
        "https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/",
      version: "4.0.18",
      values: stringify({
        nfs: {
          server: "192.168.53.40",
          path: "/mnt/tank/data/cluster/external",
        },
        storageClass: {
          defaultClass: true,
        },
      }),
    });
  }
}

const app = new Lab53App();
new NFSSubdirExternalProvisioner(app);
app.synth();
