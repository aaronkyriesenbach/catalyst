import { Project } from "../constants";
import { StatusGroup, tcpTarget } from "../status";
import type { StaticApp } from "../types";
import { mirrorRepository } from "../utils";

// The chart passes each mover image to the operator as a `--*-container-image` arg.
const imageKeys = [
  "image",
  "rclone",
  "restic",
  "rsync",
  "rsync-tls",
  "syncthing",
];
const repository = mirrorRepository("quay.io/backube/volsync");

const config: StaticApp = {
  kind: "static",
  name: "volsync",
  status: {
    targets: [
      tcpTarget(
        "VolSync",
        StatusGroup.Platform,
        "volsync-metrics.volsync-system.svc",
        8443,
      ),
    ],
  },
  namespace: "volsync-system",
  project: Project.SYSTEM,
  helmReleases: [
    {
      chart: "volsync",
      releaseName: "volsync",
      parameters: Object.fromEntries(
        imageKeys.map((key) => [`${key}.repository`, repository]),
      ),
    },
  ],
};

export default config;
