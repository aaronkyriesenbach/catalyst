import { Project } from "@catalyst/core/constants";
import type { StaticApp } from "@catalyst/core/types";
import { mirrorRepository } from "@catalyst/versions/images";

const config: StaticApp = {
  kind: "static",
  status: {
    exempt: "Controller with no endpoint; VictoriaMetrics alerts cover it",
  },
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
