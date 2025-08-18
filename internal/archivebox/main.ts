import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { Construct } from "npm:constructs";
import { INTERNAL_SUBDOMAIN } from "../../shared/constants.ts";
import GeneratedSecret from "../../shared/mittwald-secret-gen/GeneratedSecret.ts";

export class ArchiveBox extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const password = new GeneratedSecret(this, {
      name: "admin-pass",
      fieldsToGenerate: ["password"],
    });

    new Application(this, {
      name: "archivebox",
      podSpecProps: {
        containers: [{
          name: "main",
          image: "hub.int.lab53.net/archivebox/archivebox:latest",
          ports: [{ containerPort: 8000 }],
          env: [{
            name: "ADMIN_USERNAME",
            value: "aaron",
          }, {
            name: "ADMIN_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: password.name,
                key: "password",
              },
            },
          }, {
            name: "ALLOWED_HOSTS",
            value: "archivebox.int.lab53.net",
          }, {
            name: "CSRF_TRUSTED_ORIGINS",
            value: "https://archivebox.int.lab53.net",
          }, {
            name: "PUID",
            value: "1000",
          }, {
            name: "PGID",
            value: "1000",
          }],
        }],
        securityContext: undefined,
        nasVolumeMounts: {
          main: [{
            mountPath: "/data",
            subPath: "cluster/archivebox/data",
          }],
        },
      },
      webPort: 8000,
      ingressRouteSpec: {
        subdomain: INTERNAL_SUBDOMAIN,
      },
    });
  }
}

const app = new Lab53App();
new ArchiveBox(app, "archivebox");
app.synth();
