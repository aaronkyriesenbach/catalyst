import { applyModifiers, withIscsiVolumes, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildAwsExternalSecret, buildGeneratedSecret } from "../utils";

const name = "open-webui";
const namespace = "chat";
const webuiSecretKeyName = `${name}-webui-secret-key`;
const openRouterKeyName = `${name}-openrouter-key`;
const exaApiKeyName = `${name}-exa-api-key`;

const base: WorkloadApp = {
  kind: "workload",
  name,
  namespace,
  subDomain: "chat",
  externallyAccessible: true,
  strategy: { type: "Recreate" },
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/open-webui/open-webui:v0.9.6",
        ports: [{ name: "http", containerPort: 8080 }],
        env: [
          // App config
          { name: "WEBUI_URL", value: "https://chat.lab53.net" },
          { name: "GLOBAL_LOG_LEVEL", value: "INFO" },
          { name: "ENABLE_BASE_MODELS_CACHE", value: "True" },

          // SSO / OIDC
          { name: "ENABLE_OAUTH_SIGNUP", value: "true" },
          { name: "ENABLE_LOGIN_FORM", value: "false" },
          { name: "ENABLE_PASSWORD_AUTH", value: "false" },
          { name: "ENABLE_SIGNUP", value: "false" },
          {
            name: "OPENID_PROVIDER_URL",
            value: "https://auth.lab53.net/.well-known/openid-configuration",
          },
          { name: "OAUTH_PROVIDER_NAME", value: "Pocket ID" },
          { name: "OAUTH_SCOPES", value: "openid email profile" },
          {
            name: "OPENID_REDIRECT_URI",
            value: "https://chat.lab53.net/oauth/oidc/callback",
          },
          {
            name: "OAUTH_CLIENT_ID",
            valueFrom: {
              secretKeyRef: {
                name: `${name}-oidc-credentials`,
                key: "client_id",
              },
            },
          },
          {
            name: "OAUTH_CLIENT_SECRET",
            valueFrom: {
              secretKeyRef: {
                name: `${name}-oidc-credentials`,
                key: "client_secret",
              },
            },
          },

          // Persistent config — always read from env vars (GitOps friendly)
          { name: "ENABLE_PERSISTENT_CONFIG", value: "false" },
          { name: "ENABLE_OAUTH_PERSISTENT_CONFIG", value: "false" },

          // OpenRouter (OpenAI-compatible endpoint)
          {
            name: "OPENAI_API_BASE_URL",
            value: "https://openrouter.ai/api/v1",
          },
          {
            name: "OPENAI_API_KEY",
            valueFrom: {
              secretKeyRef: { name: openRouterKeyName, key: "API_KEY" },
            },
          },

          // Session encryption — must be stable across restarts
          {
            name: "WEBUI_SECRET_KEY",
            valueFrom: {
              secretKeyRef: { name: webuiSecretKeyName, key: "password" },
            },
          },

          // Web search — Exa
          { name: "ENABLE_WEB_SEARCH", value: "True" },
          { name: "WEB_SEARCH_ENGINE", value: "exa" },
          { name: "WEB_SEARCH_RESULT_COUNT", value: "5" },
          {
            name: "EXA_API_KEY",
            valueFrom: {
              secretKeyRef: { name: exaApiKeyName, key: "API_KEY" },
            },
          },

          // Agentic mode — enable native function calling for all models
          {
            name: "DEFAULT_MODEL_PARAMS",
            value: '{"function_calling": "native"}',
          },
          {
            name: "DEFAULT_MODEL_METADATA",
            value: '{"capabilities":{"web_search":true}}',
          },

          // Auth cookies
          { name: "WEBUI_AUTH_COOKIE_SAME_SITE", value: "lax" },
          { name: "WEBUI_AUTH_COOKIE_SECURE", value: "true" },
        ],
        livenessProbe: {
          httpGet: { path: "/health", port: 8080 },
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/health", port: 8080 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 8080,
  extraResources: [
    // WEBUI_SECRET_KEY: generate once, seed to AWS, read back
    ...buildGeneratedSecret(
      namespace,
      webuiSecretKeyName,
      [{ key: "password", length: 32 }],
      { persist: true },
    ),

    // OpenRouter API key: read pre-existing secret from AWS Secrets Manager
    buildAwsExternalSecret(openRouterKeyName, [
      {
        remoteKey: "lab53/cluster0/chat/openrouter-api-key",
        property: "API_KEY",
        secretKey: "API_KEY",
      },
    ]),

    // Exa search API key: read pre-existing secret from AWS Secrets Manager
    buildAwsExternalSecret(exaApiKeyName, [
      {
        remoteKey: "lab53/cluster0/chat/exa-api-key",
        property: "API_KEY",
        secretKey: "API_KEY",
      },
    ]),
  ],
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [
      {
        name: "data",
        mountPath: "/app/backend/data",
        storageRequest: "10Gi",
        backup: true,
      },
    ],
  }),
  withOidcAuth(),
);
