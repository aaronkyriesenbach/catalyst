import {
  ExternalSecret as ExternalSecretConstruct,
  ExternalSecretSpecDataRemoteRef,
  ExternalSecretSpecSecretStoreRef,
  ExternalSecretSpecSecretStoreRefKind
} from "../imports/external-secrets.io.ts";
import { Construct } from "npm:constructs";

export default class ExternalSecret extends ExternalSecretConstruct {
  constructor(scope: Construct, props: ExternalSecretProps) {
    const { name, externalSecretRef, secretStore } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        secretStoreRef: secretStore ?? {
          name: "lab53-secret-store",
          kind: ExternalSecretSpecSecretStoreRefKind.CLUSTER_SECRET_STORE,
        },
        target: {},
        data: [{
          secretKey: name,
          remoteRef: externalSecretRef,
        }],
      },
    });
  }
}

export type ExternalSecretProps = {
  name: string;
  externalSecretRef: ExternalSecretSpecDataRemoteRef;
  secretStore?: ExternalSecretSpecSecretStoreRef;
};
