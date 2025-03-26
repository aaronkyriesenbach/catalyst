import { RsaKey } from "./imports/secretgen.k14s.io.ts";
import { Construct } from "npm:constructs";

export default class GeneratedRSAKeypair extends RsaKey {
  constructor(scope: Construct, name: string) {
    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {},
    });
  }
}
