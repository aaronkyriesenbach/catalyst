import type { IContainer, IVolume, IVolumeMount } from "kubernetes-models/v1";
import { Middleware } from "@kubernetes-models/traefik/traefik.io/v1alpha1/Middleware";
import type { ResourceLike, WorkloadApp } from "./types";
import { buildGeneratedSecret } from "./utils";

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
    const containers: IContainer[] = app.podSpec.containers.map((container) => {
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

    const requestedContainers = Object.keys(mounts);
    const existingContainerNames = app.podSpec.containers.map((c) => c.name);
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
  dataSubPath?: string;
  image?: string;
};

const DEFAULT_POSTGRES_REGISTRY = "docker.int.lab53.net/library/postgres";

function postgresDataDir(version: number): string {
  if (version >= 18) return `/var/lib/postgresql/${version}/docker`;
  return "/var/lib/postgresql/data";
}

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
    const dataSubPath =
      options?.dataSubPath ?? `cluster/${app.name}/postgres`;

    const container: IContainer = {
      name: "postgres",
      image,
      restartPolicy: "Always",
      env: [
        { name: "POSTGRES_USER", value: user },
        { name: "POSTGRES_PASSWORD", value: password },
        { name: "POSTGRES_DB", value: database },
      ],
      ports: [{ name: "postgres", containerPort: 5432 }],
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
      volumeMounts: nasVolumeMounts([
        { mountPath: postgresDataDir(version), subPath: dataSubPath },
      ]),
    };

    const volumes = app.podSpec.volumes ?? [];
    const hasNasVolume = volumes.some((v) => v.name === NAS_VOLUME_NAME);

    return {
      ...app,
      podSpec: {
        ...app.podSpec,
        initContainers: [...(app.podSpec.initContainers ?? []), container],
        volumes: hasNasVolume ? volumes : [...volumes, nasVolume()],
      },
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

function buildOidcMiddleware(app: WorkloadApp): Middleware {
  const credentialsSecretName = `${app.name}-oidc-credentials`;
  const pluginSecretName = `${app.name}-oidc-plugin`;

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
            Domain: ".lab53.net",
            Secure: true,
            HttpOnly: true,
            SameSite: "lax",
          },
        },
      },
    },
  });
}

export type OidcAuthOptions = {
  middleware?: boolean;
};

export function withOidcAuth(options?: OidcAuthOptions): WorkloadModifier {
  const { middleware: addMiddleware = false } = options ?? {};

  return (app) => {
    const extraResources: ResourceLike[] = [
      buildOidcGroup(app),
      buildOidcClient(app),
    ];

    if (addMiddleware) {
      const pluginSecretName = `${app.name}-oidc-plugin`;
      extraResources.push(
        ...buildGeneratedSecret(pluginSecretName, [
          { key: "plugin-secret", length: 32, encoding: "raw" },
        ]),
        buildOidcMiddleware(app),
      );
    }

    return {
      ...app,
      forwardAuth: addMiddleware ? true : app.forwardAuth,
      extraResources: [...(app.extraResources ?? []), ...extraResources],
    };
  };
}

export function applyModifiers(
  app: WorkloadApp,
  ...modifiers: WorkloadModifier[]
): WorkloadApp {
  return modifiers.reduce((current, modifier) => modifier(current), app);
}
