import { applyModifiers, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "restic-server",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "docker.int.lab53.net/restic/rest-server:0.14.0",
        command: ["rest-server"],
        args: ["--no-auth", "--path", "/data"],
        ports: [{ name: "http", containerPort: 8000 }],
      },
    ],
  },
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "backups/volsync" }],
  }),
);
