import { EnvVar } from "./imports/k8s.ts";

export const DEFAULT_NAS_VOLUME_NAME = "nas-volume";
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

export const NAS_IP = "192.168.4.84";
export const NAS_PATH = "/mnt/tank/data";
