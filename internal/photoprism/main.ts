import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { INTERNAL_SUBDOMAIN } from "../../shared/constants.ts";
import Deployment from "../../shared/k8s/Deployment.ts";
import GeneratedPassword from "../../shared/secretgen/GeneratedPassword.ts";
import Service from "../../shared/k8s/Service.ts";

export class PhotoPrism extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const mariadbRootPassword = new GeneratedPassword(this, {
      name: "mariadb-root-password",
    });
    const mariadbUserPassword = new GeneratedPassword(this, {
      name: "mariadb-password",
    });

    const photoPrismPassword = new GeneratedPassword(this, {
      name: "photoprism-password",
    });

    new Deployment(this, {
      name: "mariadb",
      podSpecProps: {
        containers: [{
          name: "mariadb",
          image: "hub.int.lab53.net/library/mariadb:11",
          args: [
            "--innodb-buffer-pool-size=512M",
            "--transaction-isolation=READ-COMMITTED",
            "--character-set-server=utf8mb4",
            "--collation-server=utf8mb4_unicode_ci",
            "--max-connections=512",
            "--innodb-rollback-on-timeout=OFF",
            "--innodb-lock-wait-timeout=120",
          ],
          ports: [{ containerPort: 3306 }],
          env: [{
            name: "MARIADB_AUTO_UPDATE",
            value: "1",
          }, {
            name: "MARIADB_INITDB_SKIP_TZINFO",
            value: "1",
          }, {
            name: "MARIADB_DATABASE",
            value: "photoprism",
          }, {
            name: "MARIADB_USER",
            value: "photoprism",
          }, {
            name: "MARIADB_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: mariadbUserPassword.name,
                key: "password",
              },
            },
          }, {
            name: "MARIADB_ROOT_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: mariadbRootPassword.name,
                key: "password",
              },
            },
          }],
        }],
        nasVolumeMounts: {
          "mariadb": [{
            mountPath: "/var/lib/mysql",
            subPath: "photoprism/mariadb",
          }],
        },
      },
    });

    new Service(this, {
      name: "mariadb",
      serviceSpec: {
        selector: {
          app: "mariadb",
        },
        ports: [{ port: 3306 }],
      },
    });

    new Application(this, {
      name: "photoprism",
      podSpecProps: {
        containers: [{
          name: "photoprism",
          image: "hub.int.lab53.net/photoprism/photoprism:latest",
          ports: [{ containerPort: 2342 }],
          env: [{
            name: "PHOTOPRISM_ADMIN_USER",
            value: "aaron"
          }, {
            name: "PHOTOPRISM_ADMIN_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: photoPrismPassword.name,
                key: "password"
              }
            }
          }, {
            name: "PHOTOPRISM_SITE_URL",
            value: "https://photoprism.int.lab53.net"
          }, {
            name: "PHOTOPRISM_READONLY",
            value: "true"
          }, {
            name: "PHOTOPRISM_DATABASE_SERVER",
            value: "mariadb:3306"
          }, {
            name: "PHOTOPRISM_DATABASE_NAME",
            value: "photoprism"
          }, {
            name: "PHOTOPRISM_DATABASE_USER",
            value: "photoprism"
          }, {
            name: "PHOTOPRISM_DATABASE_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: mariadbUserPassword.name,
                key: "password"
              }
            }
          }],
        }],
        nasVolumeMounts: {
          photoprism: [{
            mountPath: "/photoprism/originals",
            subPath: "shotwell"
          }, {
            mountPath: "/photoprism/storage",
            subPath: "photoprism/storage"
          }]
        }
      },
      webPort: 2342,
      ingressRouteSpec: {
        subdomain: INTERNAL_SUBDOMAIN,
      },
    });
  }
}

const app = new Lab53App();
new PhotoPrism(app, "photoprism");
app.synth();
