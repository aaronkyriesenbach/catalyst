import { applyModifiers, withNasMounts, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "forscore",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/aaronkyriesenbach/forscoreviewer:0.1.0",
        ports: [{ name: "http", containerPort: 3000 }],
      },
    ],
  },
  webPort: 3000,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "forscore" }],
  }),
  withOidcAuth({ middleware: true }),
);
