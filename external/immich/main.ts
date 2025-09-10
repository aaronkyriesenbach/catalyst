import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";
import { stringify } from "npm:yaml@2.7.1";
import CNPGCluster from "../../shared/CNPGCluster.ts";
import IngressRoute from "../../shared/traefik/IngressRoute.ts";
import GeneratedExternalSecret from "../../shared/external-secrets/GeneratedExternalSecret.ts";
import {
  KubePersistentVolume,
  KubePersistentVolumeClaim,
  Quantity,
} from "../../shared/imports/k8s.ts";
import { RedisEnterpriseDatabase } from "../../shared/imports/redb-app.redislabs.com.ts";

class Immich extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const dbSecret = new GeneratedExternalSecret(this, {
      name: "db-secret",
      fieldsToGenerate: ["password"],
      extraData: {
        username: "immich",
      },
    });

    new CNPGCluster(this, {
      appName: "immich",
      imageName: "ghcr.io/tensorchord/cloudnative-vectorchord:14-0.4.3",
      instances: 3,
      secretName: dbSecret.name,
      superuser: true,
      postInitSQL: ["CREATE EXTENSION IF NOT EXISTS vchord CASCADE;"],
      postgresql: {
        sharedPreloadLibraries: ["vchord.so"],
      },
    });

    const storageSize = Quantity.fromString("1Ti");

    const pv = new KubePersistentVolume(this, crypto.randomUUID(), {
      metadata: {
        name: "immich-data",
      },
      spec: {
        accessModes: ["ReadWriteMany"],
        capacity: {
          storage: storageSize,
        },
        nfs: {
          server: "192.168.53.40",
          path: "/mnt/tank/data/immich",
        },
        storageClassName: "manual",
      },
    });

    const pvc = new KubePersistentVolumeClaim(this, crypto.randomUUID(), {
      metadata: {
        name: "immich-data",
      },
      spec: {
        accessModes: ["ReadWriteMany"],
        volumeName: pv.name,
        storageClassName: "manual",
        resources: {
          requests: {
            storage: storageSize,
          },
        },
      },
    });

    const redisDatabase = new RedisEnterpriseDatabase(
      this,
      crypto.randomUUID(),
      {
        metadata: {
          name: "immich-redis",
        },
        spec: {
          redisEnterpriseCluster: {
            name: "lab53-cluster",
          },
          memorySize: "10GB",
        },
      },
    );

    new HelmChart(this, {
      name: "immich",
      repo: "https://immich-app.github.io/immich-charts",
      values: stringify({
        image: {
          tag: "v1.141.1",
        },
        env: {
          DB_HOSTNAME: "immich-cluster-rw",
          DB_PASSWORD: {
            valueFrom: {
              secretKeyRef: {
                name: dbSecret.name,
                key: "password",
              },
            },
          },
          REDIS_HOSTNAME: redisDatabase.name,
        },
        immich: {
          persistence: {
            library: {
              existingClaim: pvc.name,
            },
          },
        },
        postgresql: {
          global: {
            postgresql: {
              auth: {
                existingSecret: dbSecret.name,
              },
            },
          },
        },
      }),
    });

    new IngressRoute(this, {
      name: "immich",
      service: {
        name: "immich-server",
        port: 2283,
      },
    });
  }
}

const app = new Lab53App();
new Immich(app);
app.synth();
