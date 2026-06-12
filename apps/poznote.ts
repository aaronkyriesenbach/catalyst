import { applyModifiers, withIscsiVolumes, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const name = "poznote";
const oidcCredentialsSecret = `${name}-oidc-credentials`;

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/timothepoznanski/poznote:6.19.1",
        env: [
          {
            name: "SQLITE_DATABASE",
            value: "/var/www/html/data/database/poznote.db",
          },
          {
            name: "POZNOTE_OIDC_CLIENT_ID",
            valueFrom: {
              secretKeyRef: {
                name: oidcCredentialsSecret,
                key: "client_id",
              },
            },
          },
          {
            name: "POZNOTE_OIDC_CLIENT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: oidcCredentialsSecret,
                key: "client_secret",
              },
            },
          },
          {
            name: "POZNOTE_OIDC_DISABLE_NORMAL_LOGIN",
            value: "true",
          },
        ],
        ports: [{ name: "http", containerPort: 80 }],
        livenessProbe: {
          exec: {
            command: [
              "wget",
              "--quiet",
              "--tries=1",
              "--timeout=5",
              "-O",
              "/dev/null",
              "http://127.0.0.1/api/health",
            ],
          },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          exec: {
            command: [
              "wget",
              "--quiet",
              "--tries=1",
              "--timeout=5",
              "-O",
              "/dev/null",
              "http://127.0.0.1/api/health",
            ],
          },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
      },
    ],
    securityContext: {},
  },
  webPort: 80,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [{ name: "data", mountPath: "/var/www/html/data", backup: true }],
  }),
  withOidcAuth(),
);
