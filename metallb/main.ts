import { Chart } from "npm:cdk8s";
import { createResourcesFromYaml, Lab53App } from "../shared/helpers.ts";
import { Construct } from "npm:constructs";
import IPAddressPool from "../shared/IPAddressPool.ts";
import L2Advertisement from "../shared/L2Advertisement.ts";

export class MetalLB extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "metallb-system" });

    createResourcesFromYaml(this, "metallb-native-v0.14.9.yaml");

    new IPAddressPool(this, {
      name: "lab53-pool",
      addresses: ["192.168.4.100-192.168.4.100"],
    });

    new L2Advertisement(this, {
      name: "lab53-pool-advertisement",
    });
  }
}

const app = new Lab53App();
new MetalLB(app, "metallb");
app.synth();
