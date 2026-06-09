import {
  ExternalSecret,
  GeneratorRef,
} from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { PushSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1alpha1";
import { Password } from "@kubernetes-models/external-secrets/generators.external-secrets.io/v1alpha1";
import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { Deployment, StatefulSet } from "kubernetes-models/apps/v1";
import type {
  IPersistentVolumeClaimSpec,
  IPersistentVolumeClaimTemplate,
  IPodSpec,
  IServicePort,
} from "kubernetes-models/v1";
import { ConfigMap, PersistentVolumeClaim, Service } from "kubernetes-models/v1";
import { parseAllDocuments, stringify } from "yaml";
import {
  awsSecretStoreRef,
  clusterGeneratorRef,
} from "./apps/external-secrets";
import type { AppConfig, StaticApp, StorageQuantity, WorkloadApp } from "./types";

export function readFile(relativePath: string, base: string): Promise<string> {
  return Bun.file(new URL(relativePath, base)).text();
}

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

type DeploymentOptions = {
  replicas?: number;
  revisionHistoryLimit?: number;
  strategy?: { type: "Recreate" | "RollingUpdate" };
};

export function buildDeployment(
  name: string,
  podSpec: IPodSpec,
  options?: DeploymentOptions,
) {
  return new Deployment({
    metadata: {
      name,
      labels: { app: name },
    },
    spec: {
      replicas: options?.replicas ?? 1,
      revisionHistoryLimit: options?.revisionHistoryLimit ?? 2,
      strategy: options?.strategy,
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: podSpec,
      },
    },
  });
}

export function buildService(name: string, ports: IServicePort[]) {
  return new Service({
    metadata: { name },
    spec: {
      selector: { app: name },
      ports,
    },
  });
}

export function buildHeadlessService(name: string, ports: IServicePort[]) {
  return new Service({
    metadata: { name },
    spec: {
      clusterIP: "None",
      selector: { app: name },
      ports,
    },
  });
}

// ArgoCD's CMP substitutes $VAR/${VAR} with empty string in rendered manifests.
// Escape $ as $$ for inline string fields (container args/env, HelmChart valuesContent).
export function escapeArgoCmp(content: string): string {
  return content.replaceAll("$", () => "$$");
}

// Embed files into a ConfigMap as base64 binaryData so the CMP substitution can't
// strip ${...}/$VAR sequences; k8s decodes it back to the file on mount.
export function buildFileConfigMap(
  name: string,
  files: Record<string, string>,
): ConfigMap {
  return new ConfigMap({
    metadata: { name },
    binaryData: Object.fromEntries(
      Object.entries(files).map(([key, content]) => [
        key,
        Buffer.from(content).toString("base64"),
      ]),
    ),
  });
}

type StatefulSetOptions = {
  replicas?: number;
  revisionHistoryLimit?: number;
};

export function buildStatefulSet(
  name: string,
  podSpec: IPodSpec,
  volumeClaimTemplates: IPersistentVolumeClaimTemplate[],
  options?: StatefulSetOptions,
) {
  return new StatefulSet({
    metadata: {
      name,
      labels: { app: name },
    },
    spec: {
      serviceName: name,
      replicas: options?.replicas ?? 1,
      revisionHistoryLimit: options?.revisionHistoryLimit ?? 2,
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: podSpec,
      },
      volumeClaimTemplates,
    },
  });
}

type RouteOptions = {
  subDomain?: string;
  serviceName?: string;
  namespace?: string;
  externallyAccessible?: boolean;
  forwardAuth?: boolean;
};

export function buildRoute(
  name: string,
  port: number,
  options?: RouteOptions,
): HTTPRoute {
  const {
    subDomain,
    serviceName,
    namespace,
    externallyAccessible,
    forwardAuth,
  } = options ?? {};
  const hostname = `${subDomain ?? name}${externallyAccessible ? "" : ".int"}.lab53.net`;

  const parentRefs = externallyAccessible
    ? [
        { name: "traefik-external", namespace: "traefik" },
        { name: "traefik-internal", namespace: "traefik" },
      ]
    : [{ name: "traefik-internal", namespace: "traefik" }];

  const filters = forwardAuth
    ? [
        {
          type: "ExtensionRef" as const,
          extensionRef: {
            group: "traefik.io",
            kind: "Middleware",
            name: "oidc-auth",
          },
        },
      ]
    : undefined;

  return new HTTPRoute({
    metadata: {
      name,
      namespace,
    },
    spec: {
      parentRefs,
      hostnames: [hostname],
      rules: [
        {
          filters,
          backendRefs: [
            {
              name: serviceName ?? name,
              port,
              namespace,
            },
          ],
        },
      ],
    },
  });
}

export type GeneratedSecretKey =
  | string
  | {
      key: string;
      length?: number;
    };

type GeneratedSecretTemplate = {
  engineVersion?: "v2";
  data: Record<string, string>;
};

type GeneratedSecretOptions = {
  pushSecret?: boolean;
  template?: GeneratedSecretTemplate;
};

const PUSH_SECRET_PREFIX = "lab53/cluster0";

const DEFAULT_LENGTH = 64;

export function buildPushSecret(
  namespace: string,
  secretName: string,
): PushSecret {
  return new PushSecret({
    metadata: { name: `${secretName}-push` },
    spec: {
      refreshInterval: "1h",
      updatePolicy: "Replace",
      deletionPolicy: "None",
      secretStoreRefs: [awsSecretStoreRef],
      selector: { secret: { name: secretName } },
      data: [
        {
          match: {
            remoteRef: {
              remoteKey: `${PUSH_SECRET_PREFIX}/${namespace}/${secretName}`,
            },
          },
        },
      ],
    },
  });
}

const DEFAULT_ISCSI_STORAGE = "10Gi";
const DEFAULT_ISCSI_STORAGE_CLASS = "truenas-iscsi";

export type PersistentVolumeAccessMode =
  | "ReadOnlyMany"
  | "ReadWriteMany"
  | "ReadWriteOnce"
  | "ReadWriteOncePod";

export function buildPvcSpec(opts: {
  storage: StorageQuantity;
  storageClassName: string;
  accessModes: PersistentVolumeAccessMode[];
  volumeName?: string;
}): IPersistentVolumeClaimSpec {
  return {
    accessModes: opts.accessModes,
    storageClassName: opts.storageClassName,
    resources: { requests: { storage: opts.storage } },
    ...(opts.volumeName ? { volumeName: opts.volumeName } : {}),
  };
}

export function buildIscsiPvcTemplate(
  name: string,
  storageRequest?: StorageQuantity,
): IPersistentVolumeClaimTemplate {
  return {
    metadata: { name },
    spec: buildPvcSpec({
      storage: storageRequest ?? DEFAULT_ISCSI_STORAGE,
      storageClassName: DEFAULT_ISCSI_STORAGE_CLASS,
      accessModes: ["ReadWriteOnce"],
    }),
  };
}

export function buildIscsiPvc(name: string, storageRequest?: StorageQuantity) {
  return new PersistentVolumeClaim(buildIscsiPvcTemplate(name, storageRequest));
}

export function buildGeneratedSecret(
  namespace: string,
  name: string,
  keys: GeneratedSecretKey[],
  options?: GeneratedSecretOptions,
): (ExternalSecret | Password | PushSecret)[] {
  const resources: (ExternalSecret | Password | PushSecret)[] = [];
  const dataFrom: Record<string, unknown>[] = [];

  for (const keyConfig of keys) {
    const keyName = typeof keyConfig === "string" ? keyConfig : keyConfig.key;
    const rewrite = [{ regexp: { source: "password", target: keyName } }];

    if (typeof keyConfig !== "string" && keyConfig.length !== undefined) {
      const customGeneratorRef: GeneratorRef = new GeneratorRef({
        kind: "Password",
        name: `${name}-${keyName}-gen`,
      });

      resources.push(
        new Password({
          metadata: { name: customGeneratorRef.name },
          spec: {
            length: keyConfig.length ?? DEFAULT_LENGTH,
            allowRepeat: true,
            noUpper: false,
          },
        }),
      );

      dataFrom.push({
        sourceRef: {
          generatorRef: customGeneratorRef,
        },
        rewrite,
      });
    } else {
      dataFrom.push({
        sourceRef: {
          generatorRef: clusterGeneratorRef,
        },
        rewrite,
      });
    }
  }

  resources.push(
    new ExternalSecret({
      metadata: { name },
      spec: {
        refreshInterval: "0",
        target: {
          name,
          ...(options?.template && { template: options.template }),
        },
        dataFrom,
      },
    }),
  );

  if (options?.pushSecret) {
    resources.push(buildPushSecret(namespace, name));
  }

  return resources;
}

function renderWorkload(config: WorkloadApp): string[] {
  const app = config.podSpec.securityContext
    ? config
    : {
        ...config,
        podSpec: {
          ...config.podSpec,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
          },
        },
      };

  const {
    name,
    podSpec,
    webPort,
    subDomain,
    externallyAccessible,
    forwardAuth,
    extraResources,
  } = app;
  const resources: string[] = [];

  if (extraResources) {
    resources.push(...extraResources.map((r) => stringify(r)));
  }

  resources.push(
    stringify(buildDeployment(name, podSpec, { strategy: app.strategy })),
  );

  const ports = podSpec.containers.flatMap((c) => c.ports ?? []);

  if (webPort && !ports.some((p) => p.containerPort === webPort)) {
    throw new Error("Web port provided but not in pod spec");
  }

  if (ports.length > 0) {
    const service = buildService(
      name,
      ports.map((p) => ({ port: p.containerPort, name: p.name })),
    );

    resources.push(stringify(service));

    if (webPort) {
      const route = buildRoute(name, webPort, {
        subDomain,
        externallyAccessible,
        forwardAuth,
      });
      resources.push(stringify(route));
    }
  }

  return resources;
}

async function renderStatic(config: StaticApp): Promise<string[]> {
  const results = config.resources?.map((r) => stringify(r)) ?? [];

  for (const url of config.remoteResources ?? []) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    const docs = parseAllDocuments(text)
      .map((doc) => doc.toJSON() as Record<string, unknown>)
      .filter(Boolean);

    results.push(...docs.map((d) => stringify(d)));
  }

  return results;
}

export async function renderAppFromConfig(config: AppConfig) {
  let resources: string[];

  switch (config.kind) {
    case "workload":
      resources = renderWorkload(config);
      break;
    case "static":
      resources = await renderStatic(config);
      break;
  }

  console.log(resources.join("\n---\n"));
}
