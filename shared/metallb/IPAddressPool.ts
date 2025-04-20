import { IpAddressPool as MetalLBIPAddressPool } from "../imports/ipaddresspool-metallb.io.ts";
import { Construct } from "npm:constructs";

export default class IPAddressPool extends MetalLBIPAddressPool {
  constructor(scope: Construct, props: IPAddressPoolProps) {
    const { name, addresses } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        addresses: addresses,
      },
    });
  }
}

export type IPAddressPoolProps = {
  name: string;
  addresses: string[];
};
