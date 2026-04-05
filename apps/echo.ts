import { AppConfig } from "../types";

const config: AppConfig = {
  name: "echo",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "hashicorp/http-echo",
      },
    ],
  },
};

export default config;
