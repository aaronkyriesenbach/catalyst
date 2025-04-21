import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { createResourcesFromYaml } from "../../shared/helpers.ts";

export class ExternalSecrets extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    createResourcesFromYaml(this, "external-secrets/crds.yaml", {
      readFromShared: true,
    });
    createResourcesFromYaml(
      this,
      "external-secrets/external-secrets-v0.16.1.yaml",
      {
        readFromShared: true,
      },
    );
  }
}
