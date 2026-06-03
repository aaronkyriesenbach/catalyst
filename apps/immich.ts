import { buildNasPersistentVolumePair } from "../storage";
import type { HelmChart, StaticApp } from "../types";
import {
  buildHeadlessService,
  buildIscsiPvc,
  buildRoute,
  buildStatefulSet,
  readFile,
} from "../utils";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "immich",
  },
  spec: {
    chart: "oci://ghcr.io/immich-app/immich-charts/immich",
    version: "0.11.1",
    valuesContent: await readFile("./immich/values.yaml", import.meta.url),
  },
};

const { pv: libraryPv, pvc: libraryPvc } = buildNasPersistentVolumePair({
  name: "immich-library",
  storage: "1Ti",
  nfsPath: "/mnt/tank/data/pictures",
});

const mlCachePvc = {
  apiVersion: "v1",
  kind: "PersistentVolumeClaim",
  ...buildIscsiPvc("immich-ml-cache"),
};

const valkeyPvc = {
  apiVersion: "v1",
  kind: "PersistentVolumeClaim",
  ...buildIscsiPvc("immich-valkey", "1Gi"),
};

const postgresStatefulSet = buildStatefulSet(
  "immich-postgres",
  {
    containers: [
      {
        name: "postgres",
        image: "ghcr.io/immich-app/postgres:14-vectorchord0.4.3-pgvectors0.2.0",
        env: [
          {
            name: "POSTGRES_USER",
            valueFrom: {
              secretKeyRef: {
                name: "immich-db",
                key: "DB_USERNAME",
              },
            },
          },
          {
            name: "POSTGRES_DB",
            valueFrom: {
              secretKeyRef: {
                name: "immich-db",
                key: "DB_DATABASE_NAME",
              },
            },
          },
          {
            name: "POSTGRES_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: "immich-db",
                key: "DB_PASSWORD",
              },
            },
          },
          {
            name: "PGDATA",
            value: "/var/lib/postgresql/data/pgdata",
          },
        ],
        ports: [{ name: "postgres", containerPort: 5432 }],
        volumeMounts: [
          {
            name: "data",
            mountPath: "/var/lib/postgresql/data",
          },
        ],
      },
    ],
  },
  [buildIscsiPvc("data")],
);

const postgresHeadlessService = buildHeadlessService("immich-postgres", [
  { name: "postgres", port: 5432 },
]);

const route = buildRoute("immich", 2283, {
  serviceName: "immich-server",
  externallyAccessible: true,
});

const config: StaticApp = {
  kind: "static",
  name: "immich",
  resources: [
    libraryPv,
    libraryPvc,
    mlCachePvc,
    valkeyPvc,
    postgresStatefulSet,
    postgresHeadlessService,
    chart,
    route,
  ],
};

export default config;
