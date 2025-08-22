import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { MariaDb, MariaDbSpecStorageSize } from "../../shared/imports/k8s.mariadb.com.ts";
import { DEFAULT_LSCR_ENV } from "../../shared/constants.ts";

class Bookstack extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new MariaDb(this, crypto.randomUUID(), {
      metadata: {
        name: "mariadb",
      },
      spec: {
        replicas: 3,
        galera: {
          enabled: true,
        },
        storage: {
          size: MariaDbSpecStorageSize.fromString("1Gi"),
        },
      },
    });

    new Application(this, {
      name: "bookstack",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "lscr.io/linuxserver/bookstack:25.07.1",
          ports: [{ containerPort: 3000 }],
          env: [{
            name: "APP_URL",
            value: "https://bookstack.lab53.net",
          }, ...DEFAULT_LSCR_ENV],
        }],
        nasVolumeMounts: {
          main: [{
            mountPath: "/config",
            subPath: "cluster/external/bookstack",
          }],
        },
      },
      webPort: 3000,
    });
  }
}

const app = new Lab53App();
new Bookstack(app);
app.synth();
