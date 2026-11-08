import { Project } from "@catalyst/core/constants";
import { applyModifiers, withIscsiVolumes } from "@catalyst/platform/modifiers";
import { httpCheck, readiness, startup } from "@catalyst/k8s/probes";
import type { WorkloadApp } from "@catalyst/core/types";
import { buildFileConfigMap } from "@catalyst/k8s/workload";
import { image } from "@catalyst/versions/images";
import { readFile } from "@catalyst/core/files";

const name = "zot";
const configConfigMapName = `${name}-config`;
const port = 5000;

const configConfigMap = buildFileConfigMap(configConfigMapName, {
  "config.json": await readFile("./zot/config.json", import.meta.url),
});

const base: WorkloadApp = {
  kind: "workload",
  name,
  project: Project.SYSTEM,
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("zot"),
        resources: {
          requests: { cpu: "25m", memory: "128Mi" },
          limits: { memory: "1Gi" },
        },
        args: ["serve", "/etc/zot/config.json"],
        ports: [{ name: "http", containerPort: port }],
        startupProbe: startup(httpCheck("/v2/", port), 120),
        readinessProbe: readiness(httpCheck("/v2/", port)),
        livenessProbe: {
          httpGet: { path: "/v2/", port },
          periodSeconds: 30,
          failureThreshold: 3,
        },
        volumeMounts: [{ name: "config", mountPath: "/etc/zot" }],
      },
    ],
    volumes: [{ name: "config", configMap: { name: configConfigMapName } }],
  },
  webPort: port,
  extraResources: [configConfigMap],
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      { name: "data", mountPath: "/var/lib/registry", storageRequest: "50Gi" },
    ],
  }),
);
