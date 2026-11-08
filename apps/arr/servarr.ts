import type { IResourceRequirements } from "kubernetes-models/v1";
import { httpCheck, readiness, startup } from "@catalyst/k8s/probes";
import type { ResourceLike, StorageQuantity } from "@catalyst/core/types";
import { buildDeployment, buildService } from "@catalyst/k8s/workload";
import { buildGeneratedSecret } from "@catalyst/k8s/secrets";
import { buildIscsiPvc } from "@catalyst/k8s/storage";
import { image } from "@catalyst/versions/images";
import type { ImageKey } from "@catalyst/versions/versions";
import {
  arrNamespace,
  mediaMount,
  mediaVolume,
  podSecurityContext,
  restrictedContainer,
  timezone,
  tmpMount,
  tmpVolume,
} from "./common";

export const API_KEY_SECRET_KEY = "api-key";

export function apiKeySecretName(app: string): string {
  return `${app}-api-key`;
}

export type ServarrSpec = {
  name: string;
  image: ImageKey;
  port: number;
  configStorage: StorageQuantity;
  /** Prowlarr only talks to indexers and the other apps, so it needs no media. */
  mountsMedia: boolean;
  mediaClaim: string;
  /** Unset keeps the namespace LimitRange defaults. */
  resources?: IResourceRequirements;
};

// Servarr apps read <APP>__<SECTION>__<KEY> from the environment over config.xml, which keeps
// auth and the API key in Git. Auth is delegated to the forward-auth route in front of the app.
function servarrEnv(spec: ServarrSpec) {
  const prefix = spec.name.toUpperCase();

  return [
    { name: "TZ", value: timezone },
    { name: `${prefix}__AUTH__METHOD`, value: "External" },
    { name: `${prefix}__AUTH__REQUIRED`, value: "Enabled" },
    {
      name: `${prefix}__AUTH__APIKEY`,
      valueFrom: {
        secretKeyRef: {
          name: apiKeySecretName(spec.name),
          key: API_KEY_SECRET_KEY,
        },
      },
    },
    { name: `${prefix}__LOG__ANALYTICSENABLED`, value: "false" },
    { name: `${prefix}__UPDATE__MECHANISM`, value: "Docker" },
    { name: `${prefix}__UPDATE__AUTOMATICALLY`, value: "false" },
  ];
}

export function buildServarr(spec: ServarrSpec): ResourceLike[] {
  const pvcName = `${spec.name}-config`;
  const ping = httpCheck("/ping", spec.port);

  return [
    // Seeded into AWS once so a rebuilt cluster keeps the key other apps were given.
    ...buildGeneratedSecret(
      arrNamespace,
      apiKeySecretName(spec.name),
      [{ key: API_KEY_SECRET_KEY, length: 32, alphanumeric: true }],
      { persist: true },
    ),
    buildIscsiPvc(pvcName, spec.configStorage),
    buildDeployment(
      spec.name,
      {
        securityContext: podSecurityContext,
        containers: [
          {
            name: "main",
            image: image(spec.image),
            ...(spec.resources && { resources: spec.resources }),
            env: servarrEnv(spec),
            ports: [{ name: "http", containerPort: spec.port }],
            readinessProbe: readiness(ping),
            startupProbe: startup(ping, 120),
            securityContext: restrictedContainer({
              readOnlyRootFilesystem: true,
            }),
            volumeMounts: [
              { name: "config", mountPath: "/config" },
              tmpMount,
              ...(spec.mountsMedia ? [mediaMount] : []),
            ],
          },
        ],
        volumes: [
          { name: "config", persistentVolumeClaim: { claimName: pvcName } },
          tmpVolume,
          ...(spec.mountsMedia ? [mediaVolume(spec.mediaClaim)] : []),
        ],
      },
      // The config volume is RWO, so the old pod must release it first.
      { strategy: { type: "Recreate" } },
    ),
    buildService(spec.name, [{ port: spec.port, name: "http" }]),
  ];
}
