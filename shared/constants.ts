import { EnvVar } from "./imports/k8s.ts";

export const DEFAULT_LSCR_ENV: EnvVar[] = [
  {
    name: "PUID",
    value: "1000",
  },
  {
    name: "PGID",
    value: "1000",
  },
  {
    name: "TZ",
    value: "America/New_York",
  },
];

export const NAS_VOLUME_NAME = "nas-volume";
export const NAS_IP = "192.168.53.40";
export const NAS_PATH = "/mnt/tank/data";
export const NAS_VOLUME_SPEC = {
  name: NAS_VOLUME_NAME,
  nfs: {
    server: NAS_IP,
    path: NAS_PATH,
  },
};
