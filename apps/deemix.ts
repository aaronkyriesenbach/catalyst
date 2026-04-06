import { AppConfig } from "../types";

const config: AppConfig = {
  name: "deemix",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/bambanah/deemix",
        env: [
          {
            name: "PUID",
            value: "1000",
          },
          {
            name: "PGID",
            value: "1000",
          },
        ],
        ports: [
          {
            containerPort: 6595,
          },
        ],
      },
    ],
  },
  webPort: 6595,
};

export default config;
