import { ConfigMap } from "kubernetes-models/v1";
import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withOidcAuth,
  withPostgres,
  withSecurityDefaults,
} from "../modifiers";

const name = "invidious";

const configMap = new ConfigMap({
  metadata: { name },
  data: {
    "config.yml": await Bun.file(
      new URL("./invidious/config.yaml", import.meta.url),
    ).text(),
  },
});

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "quay.io/invidious/invidious:latest",
        ports: [{ name: "http", containerPort: 3000 }],
        env: [
          {
            name: "INVIDIOUS_HMAC_KEY",
            valueFrom: {
              secretKeyRef: {
                name: "invidious-keys",
                key: "hmac-key",
              },
            },
          },
          {
            name: "INVIDIOUS_INVIDIOUS_COMPANION_KEY",
            valueFrom: {
              secretKeyRef: {
                name: "invidious-keys",
                key: "companion-key",
              },
            },
          },
        ],
        volumeMounts: [
          {
            name: "config",
            mountPath: "/invidious/config/config.yml",
            subPath: "config.yml",
            readOnly: true,
          },
        ],
        livenessProbe: {
          httpGet: { path: "/api/v1/trending", port: 3000 },
          initialDelaySeconds: 30,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/api/v1/trending", port: 3000 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
      {
        name: "companion",
        image: "quay.io/invidious/invidious-companion:latest",
        env: [
          {
            name: "SERVER_SECRET_KEY",
            valueFrom: {
              secretKeyRef: {
                name: "invidious-keys",
                key: "companion-key",
              },
            },
          },
        ],
        volumeMounts: [
          {
            name: "companion-cache",
            mountPath: "/var/tmp/youtubei.js",
          },
        ],
      },
    ],
    volumes: [
      { name: "config", configMap: { name } },
      { name: "companion-cache", emptyDir: {} },
    ],
  },
  webPort: 3000,
  externallyAccessible: true,
  extraResources: [configMap],
};

export default applyModifiers(base, withSecurityDefaults(), withPostgres(14), withOidcAuth());
