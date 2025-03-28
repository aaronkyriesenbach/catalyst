import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Plexmediaserver } from "./imports/plex-media-server.ts";
import { NAS_IP, NAS_PATH } from "../shared/constants.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import NASVolume from "../shared/NASVolume.ts";

export class Plex extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "plex" });

    const plexConfig = new NASVolume(this, "nas", {
      volumeName: "plex-config",
      customNASPath: "/mnt/tank/data/plex",
    });

    new IngressRoute(this, "ingress", {
      appName: "pms",
      customHostPrefix: "plex",
      customPort: 32400,
    });

    new Plexmediaserver(this, "plex", {
      releaseName: "plex",
      namespace: "plex",
      values: {
        fullnameOverride: "pms",
        extraEnv: {
          TZ: "America/New_York",
          HOSTNAME: "plex",
        },
        pms: {
          configExistingClaim: plexConfig.getPVCName(),
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
          mountPath: "/data",
        }],
      },
    });
  }
}

const app = new App();
new Plex(app, "plex");
app.synth();
