import { applyModifiers, withNasMounts, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "silverbullet",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/silverbulletmd/silverbullet:2.6.1",
        ports: [{ name: "http", containerPort: 3000 }],
      },
    ],
  },
  webPort: 3000,
  externallyAccessible: true,
  subDomain: "notes",
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/space", subPath: "documents/notes" }],
  }),
  withOidcAuth({
    middleware: {
      enabled: true,
      bypassPaths: [
        { type: "prefix", path: "/.client/" },
        { type: "exact", path: "/service_worker.js" },
      ],
    },
  }),
);
