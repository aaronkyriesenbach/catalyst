import type { IContainer, IVolume, IVolumeMount } from "kubernetes-models/v1";
import { Middleware } from "@kubernetes-models/traefik/traefik.io/v1alpha1/Middleware";
import type { WorkloadApp } from "./types";

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

export function withSecurityDefaults(id?: number): WorkloadModifier {
  return (app) => ({
    ...app,
    podSpec: {
      ...app.podSpec,
      securityContext: {
        runAsNonRoot: true,
        runAsUser: id ?? 1000,
        runAsGroup: id ?? 1000,
        ...app.podSpec.securityContext,
      },
    },
  });
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
      env: [
        { name: "POSTGRES_USER", value: user },
        { name: "POSTGRES_PASSWORD", value: password },
        { name: "POSTGRES_DB", value: database },
      ],
      ports: [{ name: "postgres", containerPort: 5432 }],
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
        containers: [...app.podSpec.containers, container],
        volumes: hasNasVolume ? volumes : [...volumes, nasVolume()],
      },
    };
  };
}

export function withOidcAuth(): WorkloadModifier {
  return (app) => {
    const middleware = new Middleware({
      metadata: { name: "oidc-auth" },
      spec: {
        plugin: {
          "traefik-oidc-auth": {
            Secret: "urn:k8s:secret:oidc-auth:plugin-secret",
            Provider: {
              Url: "https://auth.lab53.net/",
              ClientId: "urn:k8s:secret:oidc-auth:client-id",
              ClientSecret: "urn:k8s:secret:oidc-auth:client-secret",
            },
            Scopes: ["openid", "profile", "email"],
            CallbackUri: "/oidc/callback",
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

    return {
      ...app,
      forwardAuth: true,
      extraResources: [...(app.extraResources ?? []), middleware],
    };
  };
}

export function applyModifiers(
  app: WorkloadApp,
  ...modifiers: WorkloadModifier[]
): WorkloadApp {
  return modifiers.reduce((current, modifier) => modifier(current), app);
}
