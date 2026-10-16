import { Project } from "../constants";
import type { StaticApp } from "../types";

const config: StaticApp = {
  kind: "static",
  name: "volsync",
  namespace: "volsync-system",
  project: Project.SYSTEM,
  helmReleases: [{ chart: "volsync", releaseName: "volsync" }],
};

export default config;
