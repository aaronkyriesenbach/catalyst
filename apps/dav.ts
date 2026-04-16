import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withNasMounts,
  withSecurityDefaults,
} from "../modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "dav",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/aaronkyriesenbach/dav:0.0.1-SNAPSHOT",
        ports: [{ containerPort: 8080 }],
      },
    ],
  },
  webPort: 8080,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withSecurityDefaults(),
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "radicale/data" }],
  }),
);
