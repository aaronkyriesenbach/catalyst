import type { ResourceLike } from "../../types";
import { buildGeneratedSecret } from "../../utils";

export const YOUTUBE_REMOTE_LOGIN_TOKEN_SECRET = "typetype-youtube-login-token";
export const YOUTUBE_SESSION_ENCRYPTION_KEY_SECRET =
  "typetype-youtube-session-key";
export const GARAGE_RPC_SECRET = "typetype-garage-rpc-secret";
export const DOWNLOADER_S3_CREDENTIALS_SECRET =
  "typetype-downloader-s3-credentials";

const namespace = "typetype";

// Mirrors the upstream busybox init container: both generated the same way.
export const secretsResources: ResourceLike[] = [
  ...buildGeneratedSecret(namespace, YOUTUBE_REMOTE_LOGIN_TOKEN_SECRET, [
    { key: "token", length: 48, encoding: "base64url" },
  ]),
  ...buildGeneratedSecret(namespace, YOUTUBE_SESSION_ENCRYPTION_KEY_SECRET, [
    { key: "key", length: 48, encoding: "base64url" },
  ]),
  // Garage parses this as a 32-byte hex string; anything else fails Garage startup.
  ...buildGeneratedSecret(namespace, GARAGE_RPC_SECRET, [
    { key: "secret", length: 32, encoding: "hex" },
  ]),
  ...buildGeneratedSecret(namespace, DOWNLOADER_S3_CREDENTIALS_SECRET, [
    { key: "access_key", length: 24, alphanumeric: true },
    { key: "secret_key", length: 32 },
  ]),
];
