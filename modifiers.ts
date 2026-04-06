import type { IContainer, IVolumeMount } from 'kubernetes-models/v1';
import type { WorkloadApp } from './types';

export type NasMountConfig = {
  [containerName: string]: { mountPath: string; subPath?: string }[];
};

export type WorkloadModifier = (app: WorkloadApp) => WorkloadApp;

const NAS_VOLUME_NAME = 'nas';
const NAS_SERVER = '192.168.53.120';
const NAS_PATH = '/mnt/tank/data';

export function withNasMounts(mounts: NasMountConfig): WorkloadModifier {
  return (app) => {
    const containers: IContainer[] = app.podSpec.containers.map((container) => {
      const containerMounts = mounts[container.name];
      if (!containerMounts) return container;

      const newVolumeMounts: IVolumeMount[] = containerMounts.map((m) => ({
        name: NAS_VOLUME_NAME,
        mountPath: m.mountPath,
        subPath: m.subPath,
      }));

      return {
        ...container,
        volumeMounts: [...(container.volumeMounts ?? []), ...newVolumeMounts],
      };
    });

    const requestedContainers = Object.keys(mounts);
    const existingContainerNames = app.podSpec.containers.map((c) => c.name);
    const missing = requestedContainers.filter((name) => !existingContainerNames.includes(name));

    if (missing.length > 0) {
      throw new Error(
        `NAS mount config references non-existent containers: ${missing.join(', ')}`,
      );
    }

    return {
      ...app,
      podSpec: {
        ...app.podSpec,
        containers,
        volumes: [
          ...(app.podSpec.volumes ?? []),
          {
            name: NAS_VOLUME_NAME,
            nfs: { server: NAS_SERVER, path: NAS_PATH },
          },
        ],
      },
    };
  };
}

export function withSecurityDefaults(): WorkloadModifier {
  return (app) => ({
    ...app,
    podSpec: {
      ...app.podSpec,
      securityContext: {
        runAsNonRoot: true,
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
