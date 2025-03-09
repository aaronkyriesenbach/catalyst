import { EnvVar } from "./imports/k8s.ts";

export const DEFAULT_NAS_VOLUME_NAME = "nas-volume";
export const DEFAULT_LSCR_ENV_EXPORTS: EnvVar[] = [
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
