import { applyModifiers, withIscsiVolumes } from "../modifiers";
import { httpCheck, readiness, startup } from "../probes";
import type { WorkloadApp } from "../types";
import { image } from "../utils";

const base: WorkloadApp = {
  kind: "workload",
  name: "home-assistant",
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("homeAssistant"),
        env: [
          {
            name: "TZ",
            value: "America/New_York",
          },
        ],
        ports: [{ name: "http", containerPort: 8123 }],
        readinessProbe: readiness(httpCheck("/manifest.json", 8123)),
        startupProbe: startup(httpCheck("/manifest.json", 8123), 300),
      },
    ],
  },
  webPort: 8123,
  progressDeadlineSeconds: 600,
  subDomain: "home",
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [{ name: "config", mountPath: "/config", backup: true }],
  }),
);
