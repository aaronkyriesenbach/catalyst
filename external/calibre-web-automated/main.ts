import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";

import { DEFAULT_LSCR_ENV } from "../../shared/constants.ts";
import ConfigPVC from "../../shared/ConfigPVC.ts";
import Application from "../../shared/Application.ts";
import { Middleware } from "../../shared/imports/middleware-traefik.io.ts";
import { Lab53App } from "../../shared/helpers.ts";

export class CalibreWebAutomated extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "cwa" });

    const configPVC = new ConfigPVC(this, { name: "config-pvc" });

    const authMiddleware = new Middleware(this, "auth-middleware", {
      metadata: {
        name: "cwa-auth",
      },
      spec: {
        headers: {
          customRequestHeaders: {
            "CWA-User": "admin",
          },
        },
      },
    });

    new Application(this, {
      name: "calibre-web-automated",
      podSpecProps: {
        volumes: [{
          name: "config",
          persistentVolumeClaim: {
            claimName: configPVC.name,
          },
        }],
        nasVolumeMounts: {
          "calibre-web-automated": [{
            mountPath: "/cwa-book-ingest",
            subPath: "downloads/cwa-watch",
          }, {
            mountPath: "/calibre-library",
            subPath: "books",
          }],
        },
        containers: [{
          name: "calibre-web-automated",
          image: "crocodilestick/calibre-web-automated:V3.0.4",
          ports: [{ containerPort: 8083 }],
          env: DEFAULT_LSCR_ENV,
          volumeMounts: [
            {
              name: "config",
              mountPath: "/config",
            },
          ],
        }],
      },
      webPort: 8083,
      ingressRouteSpec: {
        customHostPrefix: "cwa",
        middlewares: [{ name: authMiddleware.name }],
      },
    });
  }
}

const app = new Lab53App();
new CalibreWebAutomated(app, "calibre-web-automated");
app.synth();
