import { Project } from "../constants";
import type { StaticApp } from "../types";
import { mirrorRepository } from "../utils";

const config: StaticApp = {
  kind: "static",
  name: "reloader",
  project: Project.SYSTEM,
  helmReleases: [
    {
      chart: "reloader",
      releaseName: "reloader",
      parameters: {
        "image.repository": mirrorRepository("ghcr.io/stakater/reloader"),
      },
    },
  ],
};

export default config;
