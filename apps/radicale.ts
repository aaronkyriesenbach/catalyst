import { applyModifiers, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildGeneratedSecret, readFile } from "../utils";

const name = "radicale";
const usersSecretName = `${name}-users`;

const radicaleConfig = await readFile(
  "./radicale/radicale.conf",
  import.meta.url,
);

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "docker.int.lab53.net/11notes/radicale:3.7.4",
        env: [
          { name: "RADICALE_CONFIG", value: radicaleConfig },
          {
            name: "RADICALE_USERS",
            valueFrom: {
              secretKeyRef: {
                name: usersSecretName,
                key: "users",
              },
            },
          },
        ],
        ports: [{ name: "http", containerPort: 5232 }],
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          capabilities: {
            drop: ["ALL"],
          },
        },
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
  extraResources: buildGeneratedSecret(name, usersSecretName, [{ key: "password" }], {
    template: {
      engineVersion: "v2",
      data: {
        users: '{{ htpasswd "aaron" .password "bcrypt" }}',
        password: "{{ .password }}",
      },
    },
  }),
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [
      { mountPath: "/radicale/var", subPath: "radicale/data/collections" },
    ],
  }),
);
