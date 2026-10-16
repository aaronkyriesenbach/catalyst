import { Project } from "../constants";
import type { StaticApp } from "../types";

const config: StaticApp = {
  kind: "static",
  name: "reloader",
  project: Project.SYSTEM,
  helmReleases: [{ chart: "reloader", releaseName: "reloader" }],
};

export default config;
