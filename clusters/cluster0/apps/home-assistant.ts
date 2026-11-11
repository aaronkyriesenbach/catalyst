import { applyModifiers, withIscsiVolumes } from "@catalyst/platform/modifiers";
import { httpCheck, readiness, startup } from "@catalyst/k8s/probes";
import type { WorkloadApp } from "@catalyst/core/types";
import { image } from "@catalyst/versions/images";

const base: WorkloadApp = {
  kind: "workload",
  name: "home-assistant",
  replicas: 0,
  status: { exempt: "Scaled to 0 replicas" },
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("homeAssistant"),
        resources: {
          requests: { cpu: "25m", memory: "128Mi" },
          limits: { memory: "768Mi" },
        },
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
