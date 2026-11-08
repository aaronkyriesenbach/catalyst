import {
  ExternalSecret,
  type IExternalSecretData,
  type IExternalSecretDataFromRemoteRef,
  type IExternalSecretTemplate,
  type IGeneratorRef,
  type ISecretStoreRef,
} from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { PushSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1alpha1";
import {
  Password,
  type IPasswordSpec,
} from "@kubernetes-models/external-secrets/generators.external-secrets.io/v1alpha1";
import { awsSecretStoreRef, clusterGeneratorRef } from "./external-secrets";

export type PasswordEncoding =
  "raw" | "base64" | "base64url" | "base32" | "hex";

// encoding is missing from the installed package's types (present on the CRD since ESO chart 2.3.0).
type PasswordGeneratorSpec = IPasswordSpec & { encoding?: PasswordEncoding };

export type GeneratedSecretKey =
  | string
  | {
      key: string;
      length?: number;
      /** Character set restricted to digits + letters (no symbols). */
      alphanumeric?: boolean;
      /** Re-encode the generated value, e.g. "hex" for a byte-string secret. */
      encoding?: PasswordEncoding;
    };

type GeneratedSecretOptions = {
  persist?: boolean;
  /** Needs `persist`. ESO duration after which the value is regenerated and pushed again. */
  rotate?: string;
  template?: IExternalSecretTemplate;
};

// Consumers re-read a rotating secret often so the two sides of a client secret converge quickly.
export const ROTATING_CONSUMER_REFRESH_INTERVAL = "1m";
export const STATIC_CONSUMER_REFRESH_INTERVAL = "1h";

const PUSH_SECRET_PREFIX = "lab53/cluster0";

export function awsRemoteKey(namespace: string, name: string): string {
  return `${PUSH_SECRET_PREFIX}/${namespace}/${name}`;
}

// Source of truth for generated secrets: seed AWS once, never overwrite, read back.
export const AWS_STORE: ISecretStoreRef = {
  name: awsSecretStoreRef.name,
  kind: "ClusterSecretStore",
};

type AwsExternalSecretEntry = {
  /** The remote key in AWS Secrets Manager (e.g. "lab53/cluster0/chat/openrouter-api-key"). */
  remoteKey: string;
  /** The property within the secret to extract (or omit to extract the whole secret value). */
  property?: string;
  /** The secretKey in the resulting k8s Secret (defaults to the last path segment of remoteKey). */
  secretKey?: string;
  /** Refresh interval. Default: "1h". */
  refreshInterval?: string;
};

/**
 * Build an ExternalSecret that reads one or more entries from a pre-existing
 * AWS Secrets Manager secret (not a generated secret).
 *
 * @param name - The Kubernetes Secret name to create.
 * @param entries - One or more remote-ref entries to pull.
 */
export function buildAwsExternalSecret(
  name: string,
  entries: AwsExternalSecretEntry[],
  options?: { namespace?: string },
): ExternalSecret {
  return new ExternalSecret({
    metadata: { name, namespace: options?.namespace },
    spec: {
      refreshInterval: entries[0]?.refreshInterval ?? "1h",
      secretStoreRef: AWS_STORE,
      target: { name },
      data: entries.map((e) => ({
        secretKey: e.secretKey ?? e.remoteKey.split("/").pop()!,
        remoteRef: {
          key: e.remoteKey,
          ...(e.property && { property: e.property }),
        },
      })),
    },
  });
}

export function buildSeedPushSecret(
  pushSecretName: string,
  remoteKey: string,
  property: string,
  generatorRef: IGeneratorRef,
  rotate?: string,
): PushSecret {
  return new PushSecret({
    metadata: { name: pushSecretName },
    spec: {
      // TODO: switch to a cron schedule once external-secrets supports it (external-secrets#4931).
      refreshInterval: rotate ?? "0",
      updatePolicy: rotate ? "Replace" : "IfNotExists",
      deletionPolicy: "None",
      secretStoreRefs: [awsSecretStoreRef],
      selector: { generatorRef },
      data: [
        {
          match: {
            secretKey: "password",
            remoteRef: { remoteKey, property },
          },
        },
      ],
    },
  });
}

// Get valid name for resource
function resourceName(...parts: string[]): string {
  return parts.join("-").replaceAll("_", "-").toLowerCase();
}

export function buildGeneratedSecret(
  namespace: string,
  name: string,
  keys: GeneratedSecretKey[],
  options?: GeneratedSecretOptions,
): (ExternalSecret | Password | PushSecret)[] {
  const resources: (ExternalSecret | Password | PushSecret)[] = [];

  if (options?.rotate && !options.persist) {
    throw new Error(`Secret '${name}' sets rotate without persist`);
  }
  const remoteKey = awsRemoteKey(namespace, name);
  const data: IExternalSecretData[] = [];
  const dataFrom: IExternalSecretDataFromRemoteRef[] = [];

  for (const keyConfig of keys) {
    const keyName = typeof keyConfig === "string" ? keyConfig : keyConfig.key;
    let generatorRef: IGeneratorRef;

    if (typeof keyConfig !== "string" && keyConfig.length !== undefined) {
      const spec: PasswordGeneratorSpec = {
        length: keyConfig.length,
        allowRepeat: true,
        noUpper: false,
        ...(keyConfig.alphanumeric && { symbols: 0 }),
        ...(keyConfig.encoding && { encoding: keyConfig.encoding }),
      };
      const generator = new Password({
        metadata: { name: resourceName(name, keyName, "gen") },
        spec,
      });
      resources.push(generator);
      generatorRef = {
        apiVersion: generator.apiVersion,
        kind: "Password",
        name: resourceName(name, keyName, "gen"),
      };
    } else {
      generatorRef = clusterGeneratorRef;
    }

    if (options?.persist) {
      resources.push(
        buildSeedPushSecret(
          resourceName(name, keyName, "seed"),
          remoteKey,
          keyName,
          generatorRef,
          options.rotate,
        ),
      );
      data.push({
        secretKey: keyName,
        remoteRef: { key: remoteKey, property: keyName },
      });
    } else {
      dataFrom.push({
        sourceRef: { generatorRef },
        rewrite: [{ regexp: { source: "password", target: keyName } }],
      });
    }
  }

  const target = {
    name,
    ...(options?.template && { template: options.template }),
  };

  const persistedRefreshInterval = options?.rotate
    ? ROTATING_CONSUMER_REFRESH_INTERVAL
    : STATIC_CONSUMER_REFRESH_INTERVAL;

  resources.push(
    new ExternalSecret({
      metadata: { name },
      spec: options?.persist
        ? {
            refreshInterval: persistedRefreshInterval,
            secretStoreRef: AWS_STORE,
            target,
            data,
          }
        : { refreshInterval: "0", target, dataFrom },
    }),
  );

  return resources;
}
