import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";

import Deployment from "../shared/Deployment.ts";
import { DEFAULT_LSCR_ENV, DEFAULT_NAS_VOLUME_NAME } from "../shared/constants.ts";
import { AppProps } from "../shared/AppProps.ts";
import Service from "../shared/Service.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import ConfigPVC from "../shared/ConfigPVC.ts";
import { Middleware } from "./imports/traefik.io.ts";

export class Ladder extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const configPVC = new ConfigPVC(this, "configpvc", { name: "config-pvc" });

    const appProps: AppProps = {
      appName: "calibre-web-automated",
      createNASVolume: true,
      volumes: [{
        name: "config",
        persistentVolumeClaim: {
          claimName: configPVC.name,
        },
      }],
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
          {
            name: DEFAULT_NAS_VOLUME_NAME,
            mountPath: "/cwa-book-ingest",
            subPath: "downloads/cwa-watch",
          },
          {
            name: DEFAULT_NAS_VOLUME_NAME,
            mountPath: "/calibre-library",
            subPath: "books",
          },
        ],
      }],
    };

    new Deployment(this, "deployment", appProps);

    new Service(this, "service", appProps);

    const cwaAuthMiddlewareName = "cwa-auth";

    new Middleware(this, "auth-middleware", {
      metadata: {
        name: cwaAuthMiddlewareName,
      },
      spec: {
        headers: {
          customRequestHeaders: {
            "CWA-User": "admin",
          },
        },
      },
    });

    new IngressRoute(this, "ingress", {
      customHostPrefix: "cwa",
      middlewares: [{ name: cwaAuthMiddlewareName }],
      ...appProps,
    });
  }
}

const app = new App();
new Ladder(app, "ladder");
app.synth();
