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
import { KubePersistentVolumeClaim } from "../../shared/imports/k8s.ts";

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
      imageName: "ghcr.io/tensorchord/cloudnative-vectorchord:14-0.5.0",
      instances: 3,
      secretName: dbSecret.name,
      postInitSQL: ["CREATE EXTENSION IF NOT EXISTS vchord CASCADE;"],
      postgresql: {
        sharedPreloadLibraries: ["vchord.so"],
      },
    });

    const pvc = new KubePersistentVolumeClaim(this, crypto.randomUUID(), {
      metadata: {
        name: "immich-data",
      },
      spec: {
        accessModes: ["ReadWriteMany"],
      },
    });

    new HelmChart(this, {
      name: "immich",
      repo: "oci://ghcr.io/immich-app/immich-charts/immich",
      values: stringify({
        image: {
          tag: "v1.138.1",
        },
        env: {
          DB_HOSTNAME: "immich-cluster-rw",
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
  }
}

const app = new Lab53App();
new Immich(app);
app.synth();
