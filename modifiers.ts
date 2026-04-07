import type { IContainer, IVolume, IVolumeMount } from "kubernetes-models/v1";
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

export function applyModifiers(
  app: WorkloadApp,
  ...modifiers: WorkloadModifier[]
): WorkloadApp {
  return modifiers.reduce((current, modifier) => modifier(current), app);
}
