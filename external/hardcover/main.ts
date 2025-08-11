import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import HardcoverPostgres from "./postgres.ts";
import HardcoverHasura from "./hasura.ts";

class Hardcover extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HardcoverPostgres(this);
    new HardcoverHasura(this);
  }
}

const app = new Lab53App();
new Hardcover(app);
app.synth();
