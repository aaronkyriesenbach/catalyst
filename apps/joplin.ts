import { applyModifiers, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "joplin",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "joplin/server:3.6.1",
        ports: [{ name: "http", containerPort: 22300 }],
        env: [
          {
            name: "STORAGE_DRIVER",
            value: "Type=Filesystem; Path=/data",
          },
        ],
      },
    ],
  },
  webPort: 22300,
  externallyAccessible: true,
  subDomain: "notes",
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "documents/joplin" }],
  }),
);
