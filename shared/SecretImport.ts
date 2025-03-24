import { SecretImport as KubeSecretImport } from "./imports/secretgen.carvel.dev.ts";
import { Construct } from "npm:constructs";

export default class SecretImport extends KubeSecretImport {
  constructor(scope: Construct, id: string, props: SecretImportProps) {
    const { name, fromNamespace } = props;

    super(scope, id, {
      metadata: {
        name: name,
      },
      spec: {
        fromNamespace: fromNamespace,
      },
    });
  }
}

export type SecretImportProps = {
  name: string;
  fromNamespace: string;
};
