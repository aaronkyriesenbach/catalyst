import {
  Application,
  AppProject,
} from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
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
import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { Deployment, StatefulSet } from "kubernetes-models/apps/v1";
import type {
  IPersistentVolumeClaimSpec,
  IPersistentVolumeClaimTemplate,
  IPodSecurityContext,
  IPodSpec,
  IServicePort,
} from "kubernetes-models/v1";
import {
  ConfigMap,
  PersistentVolumeClaim,
  Service,
} from "kubernetes-models/v1";
import { parse, parseAllDocuments, stringify } from "yaml";
import {
  helmCharts,
  images,
  postgresImages,
  type HelmChartEntry,
  type HelmChartKey,
  type ImageEntry,
  type ImageKey,
  type PostgresMajor,
} from "./versions";
import {
  awsSecretStoreRef,
  clusterGeneratorRef,
} from "./apps/external-secrets";
import {
  helmReleaseNamespaces,
  MIRROR_HOST,
  mirrorPrefixes,
} from "./constants";
import { assertReadinessProbe } from "./probes";
import {
  buildWafMiddleware,
  resolveWaf,
  WAF_MIDDLEWARE_NAME,
  type WafSetting,
} from "./waf";
import type {
  AppConfig,
  HelmRelease,
  ProjectSpec,
  StaticApp,
  StorageQuantity,
  WorkloadApp,
  WorkloadStrategy,
} from "./types";

export function readFile(relativePath: string, base: string): Promise<string> {
  return Bun.file(new URL(relativePath, base)).text();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readYaml(
  relativePath: string,
  base: string,
): Promise<Record<string, unknown>> {
  const parsed: unknown = parse(await readFile(relativePath, base));

  if (!isRecord(parsed)) {
    throw new Error(`${relativePath} must contain a YAML mapping`);
  }

  return parsed;
}

export function mirrorRepository(name: ImageEntry["name"]): string {
  for (const [registry, prefix] of Object.entries(mirrorPrefixes)) {
    if (name.startsWith(`${registry}/`)) {
      return `${MIRROR_HOST}/${prefix}/${name.slice(registry.length + 1)}`;
    }
  }

  throw new Error(`No mirror prefix for ${name}`);
}

function renderImage(entry: ImageEntry): string {
  const repository = entry.mirrored ? mirrorRepository(entry.name) : entry.name;

  return `${repository}:${entry.tag}`;
}

export function image(key: ImageKey): string {
  return renderImage(images[key]);
}

export function postgresImage(major: PostgresMajor): string {
  return renderImage(postgresImages[major]);
}

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

const REPO_URL = "https://github.com/aaronkyriesenbach/catalyst";

type ApplicationSource = NonNullable<Application["spec"]["sources"]>[number];

const OCI_PREFIX = "oci://";

/** Argo wants OCI `repoURL`s without the scheme, with the chart name split off. */
export function splitOciChart(chart: `oci://${string}`): {
  repoURL: string;
  chart: string;
} {
  const ref = chart.slice(OCI_PREFIX.length);
  const lastSlash = ref.lastIndexOf("/");

  return {
    repoURL: ref.slice(0, lastSlash),
    chart: ref.slice(lastSlash + 1),
  };
}

function buildHelmSource(release: HelmRelease): ApplicationSource {
  const entry: HelmChartEntry = helmCharts[release.chart];
  const location =
    entry.kind === "repo"
      ? { repoURL: entry.repo, chart: entry.chart }
      : splitOciChart(entry.chart);
  const parameters = Object.entries(release.parameters ?? {}).map(
    ([name, value]) => ({ name, value }),
  );

  return {
    ...location,
    targetRevision: entry.version,
    helm: {
      releaseName: release.releaseName,
      ...(release.skipCrds && { skipCrds: true }),
      ...(release.values !== undefined && {
        valuesObject: release.values,
      }),
      ...(parameters.length > 0 && { parameters }),
    },
  };
}

function hasCmpContent(config: AppConfig): boolean {
  if (config.kind === "workload") {
    return true;
  }

  return (
    (config.resources?.length ?? 0) > 0 ||
    (config.remoteResources?.length ?? 0) > 0
  );
}

function assertHelmReleaseNamespaces(
  config: AppConfig,
  destinationNamespace: string,
): void {
  for (const { releaseName } of config.helmReleases ?? []) {
    const pinned = helmReleaseNamespaces[releaseName];

    if (pinned !== undefined && pinned !== destinationNamespace) {
      throw new Error(
        `Helm release '${releaseName}' is installed in '${pinned}' but app '${config.name}' targets '${destinationNamespace}'`,
      );
    }
  }
}

export function appNamespace(config: AppConfig): string {
  return config.namespace ?? config.name;
}

export function buildApplication(config: AppConfig): Application {
  const { name, project, helmReleases, ignoreDifferences, autoSync } = config;
  const destinationNamespace = appNamespace(config);

  assertHelmReleaseNamespaces(config, destinationNamespace);

  const cmpSource: ApplicationSource = {
    repoURL: REPO_URL,
    path: ".",
    plugin: {
      env: [{ name: "APP", value: name }],
    },
  };
  const helmSources = (helmReleases ?? []).map(buildHelmSource);
  const hasHelm = helmSources.length > 0;
  const cmpSources = !hasHelm || hasCmpContent(config) ? [cmpSource] : [];

  return new Application({
    metadata: {
      name,
      namespace: "argocd",
      finalizers: ["resources-finalizer.argocd.argoproj.io"],
      // ServerSideApply leaves no last-applied annotation, so client-side diffs
      // report API-defaulted fields (HTTPRoute, ExternalSecret, ...) as drift.
      ...(hasHelm && {
        annotations: {
          "argocd.argoproj.io/compare-options": "ServerSideDiff=true",
        },
      }),
    },
    spec: {
      project: project ?? "default",
      ...(hasHelm
        ? { sources: [...cmpSources, ...helmSources] }
        : { source: cmpSource }),
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: destinationNamespace,
      },
      syncPolicy: {
        ...(autoSync !== false && {
          automated: { prune: true, selfHeal: false },
        }),
        syncOptions: [
          "CreateNamespace=true",
          ...(hasHelm ? ["ServerSideApply=true"] : []),
        ],
        retry: {
          limit: 5,
          backoff: { duration: "30s", factor: 2, maxDuration: "5m" },
        },
      },
      ...(ignoreDifferences !== undefined && { ignoreDifferences }),
    },
  });
}

export function buildProject(name: string, spec: ProjectSpec): AppProject {
  return new AppProject({
    metadata: {
      name,
      namespace: "argocd",
      annotations: { "argocd.argoproj.io/sync-wave": "-1" },
    },
    spec,
  });
}

// minReadySeconds keeps a pod that passes its probe once and then crashes from
// counting as Available, so the old pod isn't removed on a false positive.
const DEFAULT_MIN_READY_SECONDS = 15;
const DEFAULT_PROGRESS_DEADLINE_SECONDS = 300;

type RolloutOptions = {
  /** Reason this pod can't be probed; skips the readiness probe requirement. */
  probeExempt?: string;
};

type DeploymentOptions = RolloutOptions & {
  replicas?: number;
  revisionHistoryLimit?: number;
  strategy?: WorkloadStrategy;
  progressDeadlineSeconds?: number;
};

function buildStrategy(type: WorkloadStrategy["type"] = "RollingUpdate") {
  return type === "Recreate"
    ? { type }
    : { type, rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } };
}

export function buildDeployment(
  name: string,
  podSpec: IPodSpec,
  options?: DeploymentOptions,
) {
  assertReadinessProbe(name, podSpec, options?.probeExempt);

  return new Deployment({
    metadata: {
      name,
      labels: { app: name },
      annotations: { "reloader.stakater.com/auto": "true" },
    },
    spec: {
      replicas: options?.replicas ?? 1,
      revisionHistoryLimit: options?.revisionHistoryLimit ?? 2,
      strategy: buildStrategy(options?.strategy?.type),
      minReadySeconds: DEFAULT_MIN_READY_SECONDS,
      progressDeadlineSeconds:
        options?.progressDeadlineSeconds ?? DEFAULT_PROGRESS_DEADLINE_SECONDS,
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

export function buildFileConfigMap(
  name: string,
  files: Record<string, string>,
): ConfigMap {
  return new ConfigMap({
    metadata: { name },
    data: files,
  });
}

type StatefulSetOptions = RolloutOptions & {
  replicas?: number;
  revisionHistoryLimit?: number;
};

export function buildStatefulSet(
  name: string,
  podSpec: IPodSpec,
  volumeClaimTemplates: IPersistentVolumeClaimTemplate[],
  options?: StatefulSetOptions,
) {
  assertReadinessProbe(name, podSpec, options?.probeExempt);

  return new StatefulSet({
    metadata: {
      name,
      labels: { app: name },
    },
    spec: {
      serviceName: name,
      replicas: options?.replicas ?? 1,
      revisionHistoryLimit: options?.revisionHistoryLimit ?? 2,
      minReadySeconds: DEFAULT_MIN_READY_SECONDS,
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

type HostOptions = {
  subDomain?: string;
  externallyAccessible?: boolean;
};

export function appHostname(name: string, options?: HostOptions): string {
  const { subDomain, externallyAccessible } = options ?? {};
  return `${subDomain ?? name}${externallyAccessible ? "" : ".int"}.lab53.net`;
}

export function appUrl(name: string, options?: HostOptions): string {
  return `https://${appHostname(name, options)}`;
}

type RouteOptions = {
  subDomain?: string;
  serviceName?: string;
  namespace?: string;
  externallyAccessible?: boolean;
  forwardAuth?: boolean;
  /** Required for externally accessible routes. The `crowdsec-appsec` Middleware must exist in the route's namespace unless exempt. */
  waf?: WafSetting;
};

export function extensionRefFilter(middlewareName: string) {
  return {
    type: "ExtensionRef" as const,
    extensionRef: {
      group: "traefik.io",
      kind: "Middleware",
      name: middlewareName,
    },
  };
}

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
    waf,
  } = options ?? {};

  if (externallyAccessible && waf === undefined) {
    throw new Error(
      `Route '${name}' is externally accessible: pass waf options or an exemption reason`,
    );
  }

  const wafEnabled = resolveWaf(name, externallyAccessible, waf) !== undefined;
  const hostname = appHostname(name, { subDomain, externallyAccessible });

  const parentRefs = externallyAccessible
    ? [
        { name: "traefik-external", namespace: "traefik" },
        { name: "traefik-internal", namespace: "traefik" },
      ]
    : [{ name: "traefik-internal", namespace: "traefik" }];

  // WAF first so attacks are rejected before the OIDC redirect.
  const filters = [
    ...(wafEnabled ? [extensionRefFilter(WAF_MIDDLEWARE_NAME)] : []),
    ...(forwardAuth ? [extensionRefFilter("oidc-auth")] : []),
  ];

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
          filters: filters.length > 0 ? filters : undefined,
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
  template?: IExternalSecretTemplate;
};

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
): PushSecret {
  return new PushSecret({
    metadata: { name: pushSecretName },
    spec: {
      refreshInterval: "0",
      updatePolicy: "IfNotExists",
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

const DEFAULT_ISCSI_STORAGE = "10Gi";
const DEFAULT_ISCSI_STORAGE_CLASS = "truenas-iscsi";

export type PersistentVolumeAccessMode = NonNullable<
  IPersistentVolumeClaimSpec["accessModes"]
>[number];

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

  resources.push(
    new ExternalSecret({
      metadata: { name },
      spec: options?.persist
        ? {
            refreshInterval: "1h",
            secretStoreRef: AWS_STORE,
            target,
            data,
          }
        : { refreshInterval: "0", target, dataFrom },
    }),
  );

  return resources;
}

// Literal blocks keep embedded scripts readable; the default folds long lines into `>` blocks.
function toYaml(value: unknown): string {
  return stringify(value, { blockQuote: "literal" });
}

const defaultSecurityContext: IPodSecurityContext = {
  runAsNonRoot: true,
  runAsUser: 1000,
  runAsGroup: 1000,
  fsGroup: 1000,
  // Skips the recursive chown on every mount of a volume that is already correct.
  fsGroupChangePolicy: "OnRootMismatch",
};

function renderWorkload(config: WorkloadApp): string[] {
  const app = config.podSpec.securityContext
    ? config
    : {
        ...config,
        podSpec: {
          ...config.podSpec,
          securityContext: defaultSecurityContext,
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
  const waf = externallyAccessible ? (app.waf ?? {}) : app.waf;
  const resolvedWaf = resolveWaf(name, externallyAccessible, app.waf);

  if (extraResources) {
    resources.push(...extraResources.map((r) => toYaml(r)));
  }

  if (resolvedWaf) {
    resources.push(toYaml(buildWafMiddleware(resolvedWaf)));
  }

  resources.push(
    toYaml(
      buildDeployment(name, podSpec, {
        strategy: app.strategy,
        progressDeadlineSeconds: app.progressDeadlineSeconds,
        probeExempt: app.probeExempt,
      }),
    ),
  );

  const ports = podSpec.containers.flatMap((c) => c.ports ?? []);

  if (webPort && !ports.some((p) => p.containerPort === webPort)) {
    throw new Error("Web port provided but not in pod spec");
  }

  if (ports.length > 0) {
    const service = buildService(
      name,
      ports.map((p) => ({
        port: p.containerPort,
        name: p.name,
        protocol: p.protocol,
      })),
    );

    resources.push(toYaml(service));

    if (webPort) {
      const route = buildRoute(name, webPort, {
        subDomain,
        externallyAccessible,
        forwardAuth,
        waf,
      });
      resources.push(toYaml(route));
    }
  }

  return resources;
}

async function renderStatic(config: StaticApp): Promise<string[]> {
  const results = config.resources?.map((r) => toYaml(r)) ?? [];

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

    results.push(...docs.map((d) => toYaml(d)));
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
