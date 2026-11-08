import { Project } from "@catalyst/core/constants";
import { applyModifiers, withNasMounts } from "@catalyst/platform/modifiers";
import { readiness, tcpCheck } from "@catalyst/k8s/probes";
import { StatusGroup, tcpTarget } from "@catalyst/platform/status";
import type { WorkloadApp } from "@catalyst/core/types";
import { image } from "@catalyst/versions/images";

const base: WorkloadApp = {
  kind: "workload",
  name: "restic-server",
  status: {
    targets: [
      tcpTarget(
        "Restic Server",
        StatusGroup.Platform,
        "restic-server.restic-server.svc",
        8000,
      ),
    ],
  },
  project: Project.SYSTEM,
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("resticServer"),
        command: ["rest-server"],
        args: ["--no-auth", "--path", "/data"],
        ports: [{ name: "http", containerPort: 8000 }],
        readinessProbe: readiness(tcpCheck(8000)),
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
