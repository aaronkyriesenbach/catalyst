import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Plexmediaserver } from "./imports/plex-media-server.ts";
import { NAS_IP, NAS_PATH } from "../shared/constants.ts";

export class Plex extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Plexmediaserver(this, "plex", {
      releaseName: "plex",
      namespace: "plex",
      values: {
        extraEnv: {
          TZ: "America/New_York",
          HOSTNAME: "plex"
        },
        extraVolumes: [{
          name: "nas",
          nfs: {
            server: NAS_IP,
            path: NAS_PATH,
          },
        }],
        extraVolumeMounts: [{
          name: "nas",
          mountPath: "/data"
        }]
      },
    });
  }
}

const app = new App();
new Plex(app, "plex");
app.synth();
