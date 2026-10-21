import type { ResourceLike } from "../../types";
import { oidcIssuer } from "../../auth";
import { buildDeployment, buildService, image } from "../../utils";
import { DRAGONFLY_NAME, DRAGONFLY_PORT } from "./dragonfly";
import { DOWNLOADER_NAME, DOWNLOADER_PORT } from "./downloader";
import { TOKEN_NAME, TOKEN_PORT } from "./token";
import {
  YOUTUBE_REMOTE_LOGIN_TOKEN_SECRET,
  YOUTUBE_SESSION_ENCRYPTION_KEY_SECRET,
} from "./secrets";
import { httpCheck, readiness, startup } from "../../probes";

export const SERVER_NAME = "typetype-server";
export const SERVER_PORT = 8080;

const oidcCredentialsSecret = "typetype-oidc-credentials";

const deployment = buildDeployment(SERVER_NAME, {
  containers: [
    {
      name: "main",
      image: image("typetypeServer"),
      ports: [{ name: "http", containerPort: SERVER_PORT }],
      env: [
        {
          name: "ALLOWED_ORIGINS",
          value: "https://typetype.lab53.net",
        },
        { name: "AUTH_SESSION_TTL_DAYS", value: "30" },
        { name: "AUTH_ALLOW_INSECURE_COOKIES", value: "false" },
        {
          name: "DATABASE_URL",
          value: "jdbc:postgresql://typetype-server-postgres:5432/typetype",
        },
        { name: "DATABASE_USER", value: "typetype-server" },
        { name: "DATABASE_PASSWORD", value: "typetype-server" },
        {
          name: "DRAGONFLY_URL",
          value: `redis://${DRAGONFLY_NAME}:${DRAGONFLY_PORT}`,
        },
        {
          name: "DOWNLOADER_SERVICE_URL",
          value: `http://${DOWNLOADER_NAME}:${DOWNLOADER_PORT}`,
        },
        { name: "GITHUB_REPO", value: "TypeType-Video/TypeType" },
        {
          name: "GITHUB_ISSUE_TEMPLATE",
          value: "bug_report_backend.md",
        },
        { name: "YOUTUBE_REMOTE_LOGIN_ENABLED", value: "true" },
        {
          name: "YOUTUBE_REMOTE_LOGIN_SERVICE_URL",
          value: `http://${TOKEN_NAME}:${TOKEN_PORT}`,
        },
        {
          name: "YOUTUBE_REMOTE_LOGIN_CALLBACK_BASE_URL",
          value: `http://${SERVER_NAME}:${SERVER_PORT}`,
        },
        {
          name: "YOUTUBE_REMOTE_LOGIN_INTERNAL_TOKEN",
          valueFrom: {
            secretKeyRef: {
              name: YOUTUBE_REMOTE_LOGIN_TOKEN_SECRET,
              key: "token",
            },
          },
        },
        {
          name: "YOUTUBE_SESSION_ENCRYPTION_KEY",
          valueFrom: {
            secretKeyRef: {
              name: YOUTUBE_SESSION_ENCRYPTION_KEY_SECRET,
              key: "key",
            },
          },
        },
        { name: "YOUTUBE_REMOTE_LOGIN_TTL_MS", value: "480000" },
        { name: "YOUTUBE_REMOTE_LOGIN_MAX_SESSIONS", value: "2" },
        {
          name: "YOUTUBE_REMOTE_LOGIN_MAX_FRAME_BYTES",
          value: "524288",
        },
        { name: "OIDC_ISSUER", value: oidcIssuer("typetype") },
        { name: "OIDC_PROVIDER_NAME", value: "authentik" },
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
      ],
      readinessProbe: readiness(httpCheck("/health", SERVER_PORT)),
      startupProbe: startup(httpCheck("/health", SERVER_PORT), 180),
    },
  ],
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 1000,
    runAsGroup: 1000,
    fsGroup: 1000,
  },
});

const service = buildService(SERVER_NAME, [
  { name: "http", port: SERVER_PORT },
]);

export const serverResources: ResourceLike[] = [deployment, service];
