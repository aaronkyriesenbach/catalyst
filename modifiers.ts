import { Middleware } from "@kubernetes-models/traefik/traefik.io/v1alpha1/Middleware";
import type { IContainer, IVolume, IVolumeMount } from "kubernetes-models/v1";
import { buildBackupResources } from "./backup";
import type { CronExpression } from "./cron";
import type { ResourceLike, StorageQuantity, WorkloadApp } from "./types";
import {
  buildGeneratedSecret,
  buildHeadlessService,
  buildIscsiPvc,
  buildIscsiPvcTemplate,
  buildStatefulSet,
} from "./utils";

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

export type PostgresVariant = "alpine" | "bookworm" | "trixie";

export type PostgresOptions = {
  variant?: PostgresVariant;
  user?: string;
  password?: string;
  database?: string;
  image?: string;
  /** PVC storage request for iSCSI mode (default: "10Gi") */
  storageRequest?: StorageQuantity;
  backup?: boolean;
  backupSchedule?: CronExpression;
};

const DEFAULT_POSTGRES_REGISTRY = "docker.int.lab53.net/library/postgres";

export function withPostgres(
  version: number,
  options?: PostgresOptions,
): WorkloadModifier {
  return (app) => {
    const user = options?.user ?? app.name;
    const password = options?.password ?? app.name;
    const database = options?.database ?? app.name;
    const variant = options?.variant ?? "alpine";
    const image =
      options?.image ?? `${DEFAULT_POSTGRES_REGISTRY}:${version}-${variant}`;

    const pgEnv = [
      { name: "POSTGRES_USER", value: user },
      { name: "POSTGRES_PASSWORD", value: password },
      { name: "POSTGRES_DB", value: database },
    ];

    const pgProbes = {
      startupProbe: {
        exec: {
          command: ["pg_isready", "-U", user],
        },
        periodSeconds: 5,
        failureThreshold: 30,
      },
      readinessProbe: {
        exec: {
          command: ["pg_isready", "-U", user],
        },
        periodSeconds: 10,
        failureThreshold: 3,
      },
    };

    const postgresName = `${app.name}-postgres`;

    const statefulSet = buildStatefulSet(
      postgresName,
      {
        containers: [
          {
            name: "postgres",
            image,
            env: [
              ...pgEnv,
              { name: "PGDATA", value: "/var/lib/postgresql/data/pgdata" },
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
      ? buildBackupResources(
          app.namespace ?? app.name,
          `data-${postgresName}-0`,
          {
            schedule: options.backupSchedule,
            runAsUser: 999,
            runAsGroup: 999,
            fsGroup: 999,
          },
        )
      : [];

    return {
      ...app,
      extraResources: [
        ...(app.extraResources ?? []),
        statefulSet,
        headlessService,
        ...backupResources,
      ],
    };
  };
}

const POCKET_ID_API_VERSION = "pocketid.internal/v1alpha1";
const POCKET_ID_URL = "https://auth.lab53.net/";
const DEFAULT_MIDDLEWARE_CALLBACK_PATH = "/oidc/callback";

function buildOidcClient(app: WorkloadApp): ResourceLike {
  const credentialsSecretName = `${app.name}-oidc-credentials`;

  return {
    apiVersion: POCKET_ID_API_VERSION,
    kind: "PocketIDOIDCClient",
    metadata: { name: app.name },
    spec: {
      secret: { name: credentialsSecretName },
      allowedUserGroups: [{ name: app.name }],
    },
  };
}

function buildOidcGroup(app: WorkloadApp): ResourceLike {
  return {
    apiVersion: POCKET_ID_API_VERSION,
    kind: "PocketIDUserGroup",
    metadata: { name: app.name },
    spec: {
      friendlyName: app.name,
    },
  };
}

function buildOidcMiddleware(
  app: WorkloadApp,
  bypassPaths?: BypassPath[],
): Middleware {
  const credentialsSecretName = `${app.name}-oidc-credentials`;
  const pluginSecretName = `${app.name}-oidc-plugin`;
  const bypassRule =
    bypassPaths && bypassPaths.length > 0
      ? buildBypassRule(bypassPaths)
      : undefined;

  return new Middleware({
    metadata: { name: "oidc-auth" },
    spec: {
      plugin: {
        "traefik-oidc-auth": {
          Secret: `urn:k8s:secret:${pluginSecretName}:plugin-secret`,
          Provider: {
            Url: POCKET_ID_URL,
            ClientId: `urn:k8s:secret:${credentialsSecretName}:client_id`,
            ClientSecret: `urn:k8s:secret:${credentialsSecretName}:client_secret`,
          },
          Scopes: ["openid", "profile", "email"],
          CallbackUri: DEFAULT_MIDDLEWARE_CALLBACK_PATH,
          SessionCookie: {
            Name: `oidc-${app.name}`,
            Domain: ".lab53.net",
            Secure: true,
            HttpOnly: true,
            SameSite: "lax",
          },
          ...(bypassRule && { BypassAuthenticationRule: bypassRule }),
        },
      },
    },
  });
}

export type BypassPath = {
  type: "exact" | "prefix";
  path: `/${string}`;
};

function buildBypassRule(paths: BypassPath[]): string {
  return paths
    .map(({ type, path }) =>
      type === "exact" ? `Path(\`${path}\`)` : `PathPrefix(\`${path}\`)`,
    )
    .join(" || ");
}

export type OidcMiddlewareOptions = {
  enabled: boolean;
  bypassPaths?: BypassPath[];
};

export type OidcAuthOptions = {
  middleware?: OidcMiddlewareOptions;
};

export function withOidcAuth(options?: OidcAuthOptions): WorkloadModifier {
  const middlewareOptions = options?.middleware;
  const addMiddleware = middlewareOptions?.enabled ?? false;

  return (app) => {
    const extraResources: ResourceLike[] = [
      buildOidcGroup(app),
      buildOidcClient(app),
    ];

    if (addMiddleware) {
      const pluginSecretName = `${app.name}-oidc-plugin`;
      extraResources.push(
        ...buildGeneratedSecret(app.namespace ?? app.name, pluginSecretName, [
          { key: "plugin-secret", length: 32 },
        ]),
        buildOidcMiddleware(app, middlewareOptions?.bypassPaths),
      );
    }

    return {
      ...app,
      forwardAuth: addMiddleware ? true : app.forwardAuth,
      extraResources: [...(app.extraResources ?? []), ...extraResources],
    };
  };
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
