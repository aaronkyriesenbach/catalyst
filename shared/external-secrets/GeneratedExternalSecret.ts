import {
    ExternalSecret,
    ExternalSecretSpecDataFromSourceRefGeneratorRefKind,
    ExternalSecretSpecRefreshPolicy
} from "../imports/external-secrets.io.ts";
import { Construct } from "npm:constructs";

export default class GeneratedExternalSecret extends ExternalSecret {
  constructor(scope: Construct, props: GeneratedExternalSecretProps) {
    const { name, fieldsToGenerate, extraData } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        refreshPolicy: ExternalSecretSpecRefreshPolicy.CREATED_ONCE,
        dataFrom: fieldsToGenerate.map((field) => ({
          sourceRef: {
            generatorRef: {
              apiVersion: "generators.external-secrets.io/v1alpha1",
              kind: ExternalSecretSpecDataFromSourceRefGeneratorRefKind
                .CLUSTER_GENERATOR,
              name: "secret-generator",
            },
          },
          rewrite: [{
            regexp: {
              source: "password", // The password generator will only output the hardcoded key "password".
              target: field, // This rewrites the output to the desired field name.
            },
          }],
        })),
        target: {
          template: {
            data: {
              ...Object.fromEntries(
                fieldsToGenerate.map((field) => [field, `{{ .${field} }}`]),
              ),
              ...extraData,
            },
          },
        },
      },
    });
  }
}

export type GeneratedExternalSecretProps = {
  name: string;
  fieldsToGenerate: string[];
  extraData?: { [key: string]: string };
};
