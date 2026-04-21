import { applyModifiers, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildGeneratedSecret } from "../utils";

const credentialsSecretName = "dav-credentials";

const base: WorkloadApp = {
  kind: "workload",
  name: "dav",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/aaronkyriesenbach/dav:0.0.1-SNAPSHOT",
        ports: [{ containerPort: 8080 }],
        readinessProbe: {
          httpGet: { path: "/healthz", port: 8080 },
          periodSeconds: 30,
          timeoutSeconds: 5,
        },
        livenessProbe: {
          httpGet: { path: "/healthz", port: 8080 },
          initialDelaySeconds: 5,
          periodSeconds: 30,
          timeoutSeconds: 5,
        },
        env: [
          {
            name: "DAV_USERS_AARON_DISPLAY_NAME",
            value: "aaron",
          },
          {
            name: "DAV_USERS_AARON_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: credentialsSecretName,
                key: "aaron-password",
              },
            },
          },
        ],
      },
    ],
  },
  webPort: 8080,
  externallyAccessible: true,
  extraResources: buildGeneratedSecret(credentialsSecretName, [
    "aaron-password",
  ]),
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "radicale/data" }],
  }),
);
