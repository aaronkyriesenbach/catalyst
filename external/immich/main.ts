import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import { Construct } from "npm:constructs";
import { HelmChart } from "../../shared/HelmChart.ts";
import { stringify } from "npm:yaml@2.7.1";
import CNPGCluster from "../../shared/CNPGCluster.ts";
import {
    ExternalSecret,
    ExternalSecretSpecDataFromSourceRefGeneratorRefKind
} from "../../shared/imports/external-secrets.io.ts";
import ConfigPVC from "../../shared/ConfigPVC.ts";
import IngressRoute from "../../shared/traefik/IngressRoute.ts";

class Immich extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    const dbSecret = new ExternalSecret(this, crypto.randomUUID(), {
      metadata: {
        name: "db-secret",
      },
      spec: {
        dataFrom: [{
          sourceRef: {
            generatorRef: {
              apiVersion: "generators.external-secrets.io/v1alpha1",
              kind: ExternalSecretSpecDataFromSourceRefGeneratorRefKind
                .CLUSTER_GENERATOR,
              name: "secret-generator",
            },
          },
        }],
        target: {
          template: {
            data: {
              username: "immich",
              password: "{{ .password }}",
            },
          },
        },
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

    const pvc = new ConfigPVC(this, {
      name: "immich-data",
      accessMode: "ReadWriteMany",
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
        server: {
          persistence: {
            photos: {
              enabled: true,
              type: "nfs",
              server: "192.168.53.40",
              path: "/mnt/tank/data/shotwell",
              readOnly: true,
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
