import { KubeSecret } from "../imports/k8s.ts";
import { Construct } from "npm:constructs";

export default class GeneratedBasicAuthSecret extends KubeSecret {
  constructor(scope: Construct, props: GeneratedBasicAuthSecretProps) {
    const { name, username = "aaron" } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
        annotations: {
          "secret-generator.v1.mittwald.de/type": "basic-auth",
          "secret-generator.v1.mittwald.de/basic-auth-username": username,
        },
      },
    });
  }
}

export type GeneratedBasicAuthSecretProps = {
  name: string;
  username?: string;
};
