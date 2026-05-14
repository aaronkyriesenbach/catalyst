import { applyModifiers, withNasMounts, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "memos",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/usememos/memos:0.28.0",
        ports: [{ name: "http", containerPort: 5230 }],
        env: [
          { name: "MEMOS_INSTANCE_URL", value: "https://notes.lab53.net" },
        ],
      },
    ],
  },
  webPort: 5230,
  subDomain: "notes",
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/var/opt/memos", subPath: "notes" }],
  }),
  withOidcAuth(),
);
