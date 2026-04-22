import { Secret } from "kubernetes-models/v1";
import { nasVolume, nasVolumeMounts } from "../modifiers";
import { buildNasPersistentVolumePair } from "../storage";
import type { HelmChart, StaticApp } from "../types";
import { buildDeployment, buildRoute, buildService, readFile } from "../utils";

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

const { pv: mlCachePv, pvc: mlCachePvc } = buildNasPersistentVolumePair({
  name: "immich-ml-cache",
  storage: "10Gi",
  nfsPath: "/mnt/tank/data/cluster/immich/ml-cache",
});

const { pv: valkeyPv, pvc: valkeyPvc } = buildNasPersistentVolumePair({
  name: "immich-valkey",
  storage: "1Gi",
  nfsPath: "/mnt/tank/data/cluster/immich/valkey",
});

const postgresService = buildService("immich-postgres", [
  {
    name: "postgres",
    port: 5432,
    targetPort: 5432,
  },
]);

const postgresDeployment = buildDeployment("immich-postgres", {
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
      ],
      ports: [{ name: "postgres", containerPort: 5432 }],
      volumeMounts: nasVolumeMounts([
        {
          mountPath: "/var/lib/postgresql/data",
          subPath: "cluster/immich/postgres",
        },
      ]),
    },
  ],
  volumes: [nasVolume()],
});

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
    mlCachePv,
    mlCachePvc,
    valkeyPv,
    valkeyPvc,
    postgresService,
    postgresDeployment,
    chart,
    route,
  ],
};

export default config;
