import { KubeSecret } from "../imports/k8s.ts";
import { Construct } from "npm:constructs";

export default class GeneratedSecret extends KubeSecret {
  constructor(scope: Construct, props: GeneratedSecretProps) {
    const { name, fieldsToGenerate, length = 64 } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
        annotations: {
          "secret-generator.v1.mittwald.de/autogenerate": fieldsToGenerate.join(
            ",",
          ),
          "secret-generator.v1.mittwald.de/length": length.toString(),
        },
      },
    });
  }
}

export type GeneratedSecretProps = {
  name: string;
  fieldsToGenerate: string[];
  length?: number;
};
