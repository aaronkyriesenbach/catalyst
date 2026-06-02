import {
  applyModifiers,
  withNasMounts,
  withOidcAuth,
  withPostgres,
} from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildGeneratedSecret } from "../utils";

const name = "shakedown";
const oidcCredentialsSecret = `${name}-oidc-credentials`;
const sessionSecretName = `${name}-session-secret`;

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/aaronkyriesenbach/shakedown:0.0.1",
        env: [
          {
            name: "DATABASE_URL",
            value:
              "postgres://shakedown:shakedown@localhost:5432/shakedown?sslmode=disable",
          },
          { name: "STORAGE_ROOT", value: "/data" },
          { name: "OIDC_ISSUER", value: "https://auth.lab53.net" },
          {
            name: "OIDC_CLIENT_ID",
            valueFrom: {
              secretKeyRef: {
                name: oidcCredentialsSecret,
                key: "client_id",
              },
            },
          },
          {
            name: "OIDC_CLIENT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: oidcCredentialsSecret,
                key: "client_secret",
              },
            },
          },
          {
            name: "APP_BASE_URL",
            value: "https://jam.lab53.net",
          },
          {
            name: "SESSION_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: sessionSecretName,
                key: "session-secret",
              },
            },
          },
          {
            name: "ADMIN_GROUP",
            value: "admin",
          },
        ],
        ports: [{ name: "http", containerPort: 8080 }],
        livenessProbe: {
          httpGet: { path: "/api/health", port: 8080 },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/api/health", port: 8080 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 8080,
  externallyAccessible: true,
  subDomain: "jam",
  extraResources: buildGeneratedSecret(sessionSecretName, [
    { key: "session-secret", length: 32, encoding: "raw" },
  ]),
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [{ mountPath: "/data", subPath: "cluster/shakedown" }],
  }),
  withPostgres(16, { legacy: true }),
  withOidcAuth(),
);
