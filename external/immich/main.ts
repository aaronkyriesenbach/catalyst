import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import IngressRoute from "../../shared/IngressRoute.ts";
import CNPGCluster from "../../shared/CNPGCluster.ts";
import GeneratedPassword from "../../shared/GeneratedPassword.ts";
import NASVolume from "../../shared/NASVolume.ts";
import { createResourcesFromYaml, Lab53App } from "../../shared/helpers.ts";

export class Immich extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "immich" });

    const postgresSecret = new GeneratedPassword(this, {
      name: "immich-user",
      secretTemplate: {
        stringData: {
          username: "immich",
          password: "$(value)",
        },
      },
    });

    new CNPGCluster(this, "cluster", {
      appName: "immich",
      imageName: "ghcr.io/tensorchord/cloudnative-pgvecto.rs:16-v0.3.0", // Immich requires pgvecto.rs < v0.4.0
      postgresql: {
        sharedPreloadLibraries: ["vectors.so"],
      },
      passwordSecret: {
        name: postgresSecret.name,
        key: "password",
      },
      superuser: true, // Immich requires superuser access for database administration and automatic backups
    });

    new NASVolume(this, {
      size: "1Ti",
      customNASPath: "/mnt/tank/data/pictures",
    });

    new IngressRoute(this, {
      name: "immich",
      service: {
        name: "immich-server",
        port: 2283,
      },
      ingressRouteSpec: {
        useInsecureTransport: true,
        useForwardAuth: false,
      },
    });

    createResourcesFromYaml(this, "immich-chart.yaml", true);
  }
}

const app = new Lab53App();
new Immich(app, "immich");
app.synth();
