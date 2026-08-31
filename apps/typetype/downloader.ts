import type { ResourceLike } from "../../types";
import { buildDeployment, buildService } from "../../utils";
import { DRAGONFLY_NAME, DRAGONFLY_PORT } from "./dragonfly";
import { GARAGE_BUCKET, GARAGE_NAME, GARAGE_S3_PORT } from "./garage";
import { DOWNLOADER_S3_CREDENTIALS_SECRET } from "./secrets";

export const DOWNLOADER_NAME = "typetype-downloader";
export const DOWNLOADER_PORT = 18093;

const deployment = buildDeployment(DOWNLOADER_NAME, {
  containers: [
    {
      name: "main",
      image: "ghcr.io/typetype-video/typetype-downloader:1.6.0",
      ports: [{ name: "http", containerPort: DOWNLOADER_PORT }],
      env: [
        { name: "HTTP_PORT", value: `${DOWNLOADER_PORT}` },
        { name: "PUBLIC_BASE_URL", value: "/api/downloader" },
        { name: "TYPETYPE_API_BASE", value: "http://typetype-server:8080" },
        {
          name: "DB_URL",
          value:
            "postgres://typetype-downloader:typetype-downloader@typetype-downloader-postgres:5432/typetype_downloader?sslmode=disable",
        },
        { name: "REDIS_HOST", value: DRAGONFLY_NAME },
        { name: "REDIS_PORT", value: `${DRAGONFLY_PORT}` },
        { name: "REDIS_QUEUE_KEY", value: "downloader:queue" },
        { name: "MAX_CONCURRENT_WORKERS", value: "2" },
        { name: "MAX_QUEUE_SIZE", value: "100" },
        { name: "JOB_TTL_SECONDS", value: "600" },
        { name: "DOWNLOAD_WORKERS", value: "8" },
        { name: "DOWNLOAD_CHUNK_SIZE", value: "10485760" },
        { name: "DOWNLOAD_RANGE_MODE", value: "query" },
        { name: "MUXER", value: "avformat" },
        { name: "STORAGE_BACKEND", value: "s3" },
        {
          name: "S3_ENDPOINT",
          value: `http://${GARAGE_NAME}:${GARAGE_S3_PORT}`,
        },
        {
          name: "S3_PUBLIC_ENDPOINT",
          value: `http://${GARAGE_NAME}:${GARAGE_S3_PORT}`,
        },
        { name: "S3_REGION", value: "garage" },
        { name: "S3_BUCKET", value: GARAGE_BUCKET },
        {
          name: "S3_ACCESS_KEY",
          valueFrom: {
            secretKeyRef: {
              name: DOWNLOADER_S3_CREDENTIALS_SECRET,
              key: "access_key",
            },
          },
        },
        {
          name: "S3_SECRET_KEY",
          valueFrom: {
            secretKeyRef: {
              name: DOWNLOADER_S3_CREDENTIALS_SECRET,
              key: "secret_key",
            },
          },
        },
        { name: "S3_ARTIFACT_TTL_SECONDS", value: "7200" },
      ],
    },
  ],
  securityContext: {
    runAsNonRoot: true,
    runAsUser: 1000,
    runAsGroup: 1000,
    fsGroup: 1000,
  },
});

const service = buildService(DOWNLOADER_NAME, [
  { name: "http", port: DOWNLOADER_PORT },
]);

export const downloaderResources: ResourceLike[] = [deployment, service];
