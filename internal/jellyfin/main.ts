import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { Construct } from "npm:constructs";
import { INTERNAL_SUBDOMAIN } from "../../shared/constants.ts";

export class Jellyfin extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "jellyfin",
      podSpecProps: {
        containers: [{
          name: "jellyfin",
          image: "jellyfin/jellyfin:latest",
          ports: [{ containerPort: 8096 }],
        }],
        nasVolumeMounts: {
          jellyfin: [{
            mountPath: "/config",
            subPath: "jellyfin/config",
          }, {
            mountPath: "/cache",
            subPath: "jellyfin/cache",
          }, {
            mountPath: "/movies",
            subPath: "movies",
          }, {
            mountPath: "/tv",
            subPath: "tv",
          }],
        },
      },
      webPort: 8096,
      ingressRouteSpec: {
        subdomain: INTERNAL_SUBDOMAIN,
      },
    });
  }
}

const app = new Lab53App();
new Jellyfin(app, "jellyfin");
app.synth();
