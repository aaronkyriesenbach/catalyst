import { buildBackupResources } from "@catalyst/k8s/backup";
import {
  buildNasPersistentVolumePair,
  buildIscsiPvcTemplate,
} from "@catalyst/k8s/storage";
import type { StaticApp } from "@catalyst/core/types";
import { buildHeadlessService, buildStatefulSet } from "@catalyst/k8s/workload";
import { buildRoute } from "@catalyst/k8s/route";
import { image, mirrorRepository } from "@catalyst/versions/images";
import { readYaml } from "@catalyst/core/files";
import { postgresProbes } from "@catalyst/k8s/probes";
import {
  httpTarget,
  routeTargets,
  serviceUrl,
  StatusGroup,
} from "@catalyst/platform/status";

const { pv: libraryPv, pvc: libraryPvc } = buildNasPersistentVolumePair({
  name: "immich-library",
  storage: "1Ti",
  nfsPath: "/mnt/tank/data/pictures",
});

const postgresStatefulSet = buildStatefulSet(
  "immich-postgres",
  {
    containers: [
      {
        name: "postgres",
        image: image("immichPostgres"),
        resources: {
          requests: { cpu: "50m", memory: "256Mi" },
          limits: { memory: "1Gi" },
        },
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
        ...postgresProbes(
          "sh",
          "-c",
          'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
        ),
        volumeMounts: [
          {
            name: "data",
            mountPath: "/var/lib/postgresql/data",
          },
        ],
      },
    ],
  },
  [buildIscsiPvcTemplate("data")],
);

const postgresHeadlessService = buildHeadlessService("immich-postgres", [
  { name: "postgres", port: 5432 },
]);

const route = buildRoute("immich", 2283, {
  serviceName: "immich-server",
  externallyAccessible: true,
  waf: {
    exempt:
      "Large uploads: AppSec buffers request bodies, and a cancelled upload is turned into a ban",
  },
});

const config: StaticApp = {
  kind: "static",
  name: "immich",
  status: {
    targets: [
      httpTarget(
        "Immich",
        StatusGroup.Media,
        serviceUrl("immich-server", "immich", 2283, "/api/server/ping"),
      ),
      ...routeTargets("Immich", "immich", { externallyAccessible: true }),
    ],
  },
  resources: [
    libraryPv,
    libraryPvc,
    postgresStatefulSet,
    postgresHeadlessService,
    route,
    ...buildBackupResources("immich", "data-immich-postgres-0", {
      runAsUser: 999,
      runAsGroup: 999,
      fsGroup: 999,
    }),
  ],
  helmReleases: [
    {
      chart: "immich",
      releaseName: "immich",
      values: await readYaml("./immich/values.yaml", import.meta.url),
      parameters: {
        "server.controllers.main.containers.main.image.repository":
          mirrorRepository("ghcr.io/immich-app/immich-server"),
        "machine-learning.controllers.main.containers.main.image.repository":
          mirrorRepository("ghcr.io/immich-app/immich-machine-learning"),
        "valkey.controllers.main.containers.main.image.repository":
          mirrorRepository("docker.io/valkey/valkey"),
      },
    },
  ],
};

export default config;
