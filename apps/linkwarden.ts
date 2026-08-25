import {
  applyModifiers,
  withIscsiVolumes,
  withOidcAuth,
  withPostgres,
} from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildGeneratedSecret } from "../utils";

const name = "linkwarden";
const oidcCredentialsSecret = `${name}-oidc-credentials`;
const nextAuthSecretName = `${name}-nextauth-secret`;

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/linkwarden/linkwarden:v2.16.1",
        ports: [{ name: "http", containerPort: 3000 }],
        env: [
          {
            name: "NEXTAUTH_URL",
            value: "https://linkwarden.lab53.net/api/v1/auth",
          },
          {
            name: "NEXTAUTH_SECRET",
            valueFrom: {
              secretKeyRef: { name: nextAuthSecretName, key: "secret" },
            },
          },
          {
            name: "DATABASE_URL",
            value:
              "postgresql://linkwarden:linkwarden@linkwarden-postgres:5432/linkwarden",
          },
          { name: "DISABLE_BROWSER", value: "true" },

          { name: "NEXT_PUBLIC_OIDC_ENABLED", value: "true" },
          { name: "OIDC_CUSTOM_NAME", value: "Pocket ID" },
          {
            name: "OIDC_WELLKNOWN_URL",
            value: "https://auth.lab53.net/.well-known/openid-configuration",
          },
          { name: "OIDC_SCOPES", value: "openid email profile" },
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
          { name: "NEXT_PUBLIC_CREDENTIALS_ENABLED", value: "false" },
          { name: "NEXT_PUBLIC_DISABLE_REGISTRATION", value: "true" },
        ],
        livenessProbe: {
          httpGet: { path: "/", port: 3000 },
          initialDelaySeconds: 30,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/", port: 3000 },
          initialDelaySeconds: 15,
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 3000,
  externallyAccessible: true,
  extraResources: [
    ...buildGeneratedSecret(
      name,
      nextAuthSecretName,
      [{ key: "secret", length: 32 }],
      { persist: true },
    ),
  ],
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      {
        name: "data",
        mountPath: "/data/data",
        storageRequest: "20Gi",
        backup: true,
      },
    ],
  }),
  withPostgres(16, { backup: true }),
  withOidcAuth(),
);
