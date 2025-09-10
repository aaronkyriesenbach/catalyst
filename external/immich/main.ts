import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";
import { stringify } from "npm:yaml@2.7.1";
import CNPGCluster from "../../shared/CNPGCluster.ts";
import ConfigPVC from "../../shared/ConfigPVC.ts";
import IngressRoute from "../../shared/traefik/IngressRoute.ts";
import GeneratedExternalSecret from "../../shared/external-secrets/GeneratedExternalSecret.ts";
import { KubePersistentVolume } from "../../shared/imports/k8s.ts";

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

    const pv = new KubePersistentVolume(this, crypto.randomUUID(), {
      metadata: {
        name: "immich-data",
      },
      spec: {
        nfs: {
          server: "192.168.53.40",
          path: "/mnt/tank/data/immich",
        },
      },
    });

    const pvc = new ConfigPVC(this, {
      name: "immich-data",
      accessMode: "ReadWriteMany",
      persistentVolume: pv.name,
    });

    new HelmChart(this, {
      name: "immich",
      repo: "https://immich-app.github.io/immich-charts",
      values: stringify({
        image: {
          tag: "v1.138.1",
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
        redis: {
          enabled: true,
        },
        // server: {
        //   persistence: {
        //     photos: {
        //       enabled: true,
        //       type: "nfs",
        //       server: "192.168.53.40",
        //       path: "/mnt/tank/data/pictures",
        //     },
        //   },
        // },
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
