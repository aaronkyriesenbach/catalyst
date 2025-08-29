import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import { LLDAP } from "./lldap.ts";
import { PocketID } from "./pocketid.ts";

class Auth extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new LLDAP(this);
    new PocketID(this);
  }
}

const app = new Lab53App();
new Auth(app);
app.synth();
