import type {
  IPodSecurityContext,
  ISecurityContext,
  IVolume,
  IVolumeMount,
} from "kubernetes-models/v1";
import { buildNasPersistentVolumePair } from "@catalyst/k8s/storage";

export const arrNamespace = "arr";

export const timezone = "America/New_York";
export const nonRootId = 1000;
// Pod CIDR of the cluster; qBittorrent and SABnzbd trust it because forward auth guards the route.
export const podCidr = "10.42.0.0/16";

// Every app mounts the same export at the same path, so a hardlink or atomic move between
// downloads and a library never crosses a mount point and paths agree between apps.
export const mediaMountPath = "/data";
export const mediaNfsPath = "/mnt/tank/data/media";
export const mediaPaths = {
  movies: `${mediaMountPath}/movies`,
  tv: `${mediaMountPath}/tv`,
  music: `${mediaMountPath}/music`,
  torrents: `${mediaMountPath}/downloads/torrents`,
  torrentsIncomplete: `${mediaMountPath}/downloads/torrents/incomplete`,
  usenetComplete: `${mediaMountPath}/downloads/usenet/complete`,
  usenetIncomplete: `${mediaMountPath}/downloads/usenet/incomplete`,
} as const;

export const podSecurityContext: IPodSecurityContext = {
  runAsNonRoot: true,
  runAsUser: nonRootId,
  runAsGroup: nonRootId,
  fsGroup: nonRootId,
  fsGroupChangePolicy: "OnRootMismatch",
  seccompProfile: { type: "RuntimeDefault" },
};

// The Pod Security `restricted` profile, plus a read-only root for images that support one.
export function restrictedContainer(
  overrides?: Pick<ISecurityContext, "readOnlyRootFilesystem">,
): ISecurityContext {
  return {
    runAsNonRoot: true,
    runAsUser: nonRootId,
    runAsGroup: nonRootId,
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
    seccompProfile: { type: "RuntimeDefault" },
    ...overrides,
  };
}

export const tmpVolume: IVolume = { name: "tmp", emptyDir: {} };
export const tmpMount: IVolumeMount = { name: "tmp", mountPath: "/tmp" };

export const mediaMount: IVolumeMount = {
  name: "media",
  mountPath: mediaMountPath,
};

export const mediaClaim = `${arrNamespace}-media`;

export function mediaVolume(claimName: string): IVolume {
  return { name: "media", persistentVolumeClaim: { claimName } };
}

export function buildMediaVolume() {
  return buildNasPersistentVolumePair({
    name: mediaClaim,
    storage: "1Ti",
    nfsPath: mediaNfsPath,
  });
}
