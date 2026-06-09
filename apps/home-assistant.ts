import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "home-assistant",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/home-assistant/home-assistant:2026.6.1",
        env: [
          {
            name: "TZ",
            value: "America/New_York",
          },
        ],
        ports: [{ name: "http", containerPort: 8123 }],
      },
    ],
  },
  webPort: 8123,
  subDomain: "home",
};

export default base;
