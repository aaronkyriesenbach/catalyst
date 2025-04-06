import { L2Advertisement as MetalLBL2Advertisement } from "./imports/l2advertisement-metallb.io.ts";
import { Construct } from "npm:constructs";

export default class L2Advertisement extends MetalLBL2Advertisement {
  constructor(scope: Construct, props: L2AdvertisementProps) {
    const { name } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
    });
  }
}

export type L2AdvertisementProps = {
  name: string;
};
