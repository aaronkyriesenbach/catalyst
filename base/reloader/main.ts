import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { createResourcesFromYaml } from "../../shared/helpers.ts";

export class Reloader extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    createResourcesFromYaml(this, "./reloader/reloader-v1.4.1.yaml", {
      readFromShared: true,
    });
  }
}
