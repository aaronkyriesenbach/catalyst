import type { WorkloadApp } from "../types";
import { applyModifiers, withNasMounts } from "../modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "radicale",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "tomsquest/docker-radicale:3.6.1.0",
        env: [{ name: "TAKE_FILE_OWNERSHIP", value: "false" }],
        ports: [{ name: "http", containerPort: 5232 }],
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: {
            drop: ["ALL"],
            add: ["SETUID", "SETGID", "KILL"],
          },
        },
        volumeMounts: [
          {
            name: "nas",
            mountPath: "/config",
            subPath: "cluster/radicale/config",
            readOnly: true,
          },
        ],
        livenessProbe: {
          httpGet: {
            path: "/",
            port: 5232,
          },
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: {
            path: "/",
            port: 5232,
          },
          periodSeconds: 30,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 5232,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "radicale/data" }],
  }),
);
