import { ExternalSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import type { IContainer, IVolume, IVolumeMount } from "kubernetes-models/v1";
import {
  authentikNamespace,
  DEFAULT_CLIENT_SECRET_ROTATION,
  oidcCredentialsSecretName,
  oidcIssuer,
  oidcSecretName,
} from "./auth";
import { buildBackupResources } from "./backup";
import type { CronExpression } from "./cron";
import { postgresProbes } from "./probes";
import type {
  OAuth2OidcDeclaration,
  ResourceLike,
  StorageQuantity,
  WorkloadApp,
} from "./types";
import {
  AWS_STORE,
  awsRemoteKey,
  buildHeadlessService,
  buildIscsiPvc,
  buildIscsiPvcTemplate,
  buildStatefulSet,
  postgresImage,
  ROTATING_CONSUMER_REFRESH_INTERVAL,
  STATIC_CONSUMER_REFRESH_INTERVAL,
} from "./utils";
import type { PostgresMajor } from "./versions";
import type { WafOptions } from "./waf";

export type NasMountConfig = {
  [containerName: string]: { mountPath: string; subPath?: string }[];
};

export type WorkloadModifier = (app: WorkloadApp) => WorkloadApp;

const NAS_VOLUME_NAME = "nas";
const NAS_SERVER = "192.168.53.120";
const NAS_PATH = "/mnt/tank/data";

export function nasVolume(): IVolume {
  return {
    name: NAS_VOLUME_NAME,
    nfs: { server: NAS_SERVER, path: NAS_PATH },
  };
}

export function nasVolumeMounts(
  mounts: { mountPath: string; subPath?: string }[],
): IVolumeMount[] {
  return mounts.map((m) => ({
    name: NAS_VOLUME_NAME,
    mountPath: m.mountPath,
    subPath: m.subPath,
  }));
}

export function withNasMounts(mounts: NasMountConfig): WorkloadModifier {
  return (app) => {
    const applyMounts = (containers: IContainer[]): IContainer[] =>
      containers.map((container) => {
        const containerMounts = mounts[container.name];
        if (!containerMounts) return container;

        return {
          ...container,
          volumeMounts: [
            ...(container.volumeMounts ?? []),
            ...nasVolumeMounts(containerMounts),
          ],
        };
      });

    const containers = applyMounts(app.podSpec.containers);
    const initContainers = app.podSpec.initContainers
      ? applyMounts(app.podSpec.initContainers as IContainer[])
      : undefined;

    const requestedContainers = Object.keys(mounts);
    const existingContainerNames = [
      ...app.podSpec.containers.map((c) => c.name),
      ...(app.podSpec.initContainers ?? []).map((c) => c.name),
    ];
    const missing = requestedContainers.filter(
      (name) => !existingContainerNames.includes(name),
    );

    if (missing.length > 0) {
      throw new Error(
        `NAS mount config references non-existent containers: ${missing.join(", ")}`,
      );
    }

    return {
      ...app,
      podSpec: {
        ...app.podSpec,
        containers,
        ...(initContainers && { initContainers }),
        volumes: [...(app.podSpec.volumes ?? []), nasVolume()],
      },
    };
  };
}

export type PostgresOptions = {
  user?: string;
  password?: string;
  database?: string;
  image?: string;
  /** PVC storage request for iSCSI mode (default: "10Gi") */
  storageRequest?: StorageQuantity;
  backup?: boolean;
  backupSchedule?: CronExpression;
};

/**
 * Build a standalone Postgres StatefulSet + headless Service (+ optional backup
 * resources), addressable at `<name>-postgres:5432`. Shared by `withPostgres`
 * and by apps that need more than one independent Postgres instance (where
 * calling `withPostgres` twice on the same app would collide on the name).
 */
export function buildPostgresResources(
  name: string,
  namespace: string,
  version: PostgresMajor,
  options?: PostgresOptions,
): ResourceLike[] {
  const user = options?.user ?? name;
  const password = options?.password ?? name;
  const database = options?.database ?? name;
  const image = options?.image ?? postgresImage(version);

  const pgEnv = [
    { name: "POSTGRES_USER", value: user },
    { name: "POSTGRES_PASSWORD", value: password },
    { name: "POSTGRES_DB", value: database },
  ];

  const pgProbes = postgresProbes("pg_isready", "-U", user);

  const postgresName = `${name}-postgres`;

  const statefulSet = buildStatefulSet(
    postgresName,
    {
      containers: [
        {
          name: "postgres",
          image,
          env: [
            ...pgEnv,
            {
              name: "PGDATA",
              value: "/var/lib/postgresql/data/pgdata",
            },
          ],
          ports: [{ name: "postgres", containerPort: 5432 }],
          ...pgProbes,
          volumeMounts: [
            {
              name: "data",
              mountPath: "/var/lib/postgresql/data",
            },
          ],
        },
      ],
    },
    [buildIscsiPvcTemplate("data", options?.storageRequest)],
  );

  const headlessService = buildHeadlessService(postgresName, [
    { name: "postgres", port: 5432 },
  ]);

  const backupResources = options?.backup
    ? buildBackupResources(namespace, `data-${postgresName}-0`, {
        schedule: options.backupSchedule,
        runAsUser: 999,
        runAsGroup: 999,
        fsGroup: 999,
      })
    : [];

  return [statefulSet, headlessService, ...backupResources];
}

export function withPostgres(
  version: PostgresMajor,
  options?: PostgresOptions,
): WorkloadModifier {
  return (app) => ({
    ...app,
    extraResources: [
      ...(app.extraResources ?? []),
      ...buildPostgresResources(
        app.name,
        app.namespace ?? app.name,
        version,
        options,
      ),
    ],
  });
}

export function withForwardAuth(options?: {
  skipPathRegex?: readonly string[];
}): WorkloadModifier {
  return (app) => {
    if (!app.webPort) {
      throw new Error(`App '${app.name}' needs a webPort for forward auth`);
    }

    return {
      ...app,
      oidc: {
        kind: "proxy",
        ...(options?.skipPathRegex && { skipPathRegex: options.skipPathRegex }),
      },
    };
  };
}

export function buildOidcCredentialsSecret(
  appName: string,
  rotating: boolean,
): ExternalSecret {
  const secretName = oidcCredentialsSecretName(appName);

  return new ExternalSecret({
    metadata: { name: secretName },
    spec: {
      refreshInterval: rotating
        ? ROTATING_CONSUMER_REFRESH_INTERVAL
        : STATIC_CONSUMER_REFRESH_INTERVAL,
      secretStoreRef: AWS_STORE,
      target: {
        name: secretName,
        template: {
          data: {
            client_id: appName,
            client_secret: "{{ .client_secret }}",
            issuer_url: oidcIssuer(appName),
          },
        },
      },
      data: [
        {
          secretKey: "client_secret",
          remoteRef: {
            key: awsRemoteKey(authentikNamespace, oidcSecretName(appName)),
            property: "client_secret",
          },
        },
      ],
    },
  });
}

export type OidcClientOptions = {
  redirectPaths: readonly `/${string}`[];
  rotate?: string | false;
};

export function defineOidcClient(
  appName: string,
  options: OidcClientOptions,
): { oidc: OAuth2OidcDeclaration; credentialsSecret: ExternalSecret } {
  return {
    oidc: {
      kind: "oauth2",
      redirectPaths: options.redirectPaths,
      rotate: options.rotate ?? DEFAULT_CLIENT_SECRET_ROTATION,
    },
    credentialsSecret: buildOidcCredentialsSecret(
      appName,
      options.rotate !== false,
    ),
  };
}

export function withOidcClient(options: OidcClientOptions): WorkloadModifier {
  return (app) => {
    if (!app.webPort) {
      throw new Error(`App '${app.name}' needs a webPort for an OIDC client`);
    }

    const { oidc, credentialsSecret } = defineOidcClient(app.name, options);

    return {
      ...app,
      oidc,
      extraResources: [...(app.extraResources ?? []), credentialsSecret],
    };
  };
}

export function withWaf(options: WafOptions): WorkloadModifier {
  return (app) => ({ ...app, waf: options });
}

export function withoutWaf(reason: string): WorkloadModifier {
  return (app) => ({ ...app, waf: { exempt: reason } });
}

export type IscsiVolumeMount = {
  name: string;
  mountPath: string;
  storageRequest?: StorageQuantity;
  backup?: boolean;
  backupSchedule?: CronExpression;
};

export type IscsiVolumesConfig = {
  [containerName: string]: IscsiVolumeMount[];
};

export function withIscsiVolumes(config: IscsiVolumesConfig): WorkloadModifier {
  return (app) => {
    const requestedContainers = Object.keys(config);
    const existingContainerNames = [
      ...app.podSpec.containers.map((c) => c.name),
      ...(app.podSpec.initContainers ?? []).map((c) => c.name),
    ];
    const missing = requestedContainers.filter(
      (name) => !existingContainerNames.includes(name),
    );

    if (missing.length > 0) {
      throw new Error(
        `iSCSI volume config references non-existent containers: ${missing.join(", ")}`,
      );
    }

    const allMounts = Object.values(config).flat();

    const pvcs: ResourceLike[] = allMounts.map((mount) =>
      buildIscsiPvc(`${app.name}-${mount.name}`, mount.storageRequest),
    );

    const volumes: IVolume[] = allMounts.map((mount) => ({
      name: mount.name,
      persistentVolumeClaim: { claimName: `${app.name}-${mount.name}` },
    }));

    const applyMounts = (containers: IContainer[]): IContainer[] =>
      containers.map((container) => {
        const containerMounts = config[container.name];
        if (!containerMounts) return container;

        return {
          ...container,
          volumeMounts: [
            ...(container.volumeMounts ?? []),
            ...containerMounts.map((m) => ({
              name: m.name,
              mountPath: m.mountPath,
            })),
          ],
        };
      });

    const containers = applyMounts(app.podSpec.containers);
    const initContainers = app.podSpec.initContainers
      ? applyMounts(app.podSpec.initContainers as IContainer[])
      : undefined;

    return {
      ...app,
      strategy: { type: "Recreate" },
      podSpec: {
        ...app.podSpec,
        containers,
        ...(initContainers && { initContainers }),
        volumes: [...(app.podSpec.volumes ?? []), ...volumes],
      },
      extraResources: [
        ...(app.extraResources ?? []),
        ...pvcs,
        ...allMounts
          .filter((mount) => mount.backup)
          .flatMap((mount) =>
            buildBackupResources(
              app.namespace ?? app.name,
              `${app.name}-${mount.name}`,
              {
                schedule: mount.backupSchedule,
              },
            ),
          ),
      ],
    };
  };
}

export function applyModifiers(
  app: WorkloadApp,
  ...modifiers: WorkloadModifier[]
): WorkloadApp {
  return modifiers.reduce((current, modifier) => modifier(current), app);
}
