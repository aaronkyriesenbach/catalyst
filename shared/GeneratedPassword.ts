import { Password, PasswordSpecSecretTemplate } from "./imports/secretgen.k14s.io.ts";
import { Construct } from "npm:constructs";
import { SecretExport } from "./imports/secretgen.carvel.dev.ts";

export default class GeneratedPassword extends Password {
  constructor(scope: Construct, props: GeneratedPasswordProps) {
    const { name, secretTemplate, length, exportNamespaces } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        length: length,
        secretTemplate: secretTemplate,
      },
    });

    if (exportNamespaces) {
      exportNamespaces.forEach((ns) =>
        new SecretExport(this, `${ns}-export`, {
          metadata: {
            name: name, // The name of the export must match the name of the secret to export
          },
          spec: {
            toNamespaces: exportNamespaces,
          },
        })
      );
    }
  }
}

export type GeneratedPasswordProps = {
  name: string;
  secretTemplate?: PasswordSpecSecretTemplate;
  length?: number;
  exportNamespaces?: string[];
};
