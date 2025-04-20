import { SecretImport as SecretImportResource } from "../imports/secretgen.carvel.dev.ts";
import { Construct } from "npm:constructs";

export default class SecretImport extends SecretImportResource {
  constructor(scope: Construct, props: SecretImportProps) {
    const { name, fromNamespace } = props;

    super(scope, crypto.randomUUID(), {
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
