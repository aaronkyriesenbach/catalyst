import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import IngressRoute from "../shared/IngressRoute.ts";
import { Lab53App, readTextFileSync } from "../shared/helpers.ts";
import ConfigMap from "../shared/ConfigMap.ts";
import Application from "../shared/Application.ts";

export class TraefikExternal extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const traefikConfigMap = new ConfigMap(this, {
      name: "traefik-external-config",
      data: {
        "traefik.yaml": readTextFileSync("traefik.yaml"),
        "dynamic.yaml": readTextFileSync("dynamic.yaml"),
      },
    });

    new Application(this, {
      name: "traefik-external",
      podSpecProps: {
        volumes: [{
          name: traefikConfigMap.name,
          configMap: {
            name: traefikConfigMap.name,
          },
        }],
        containers: [{
          name: "traefik-external",
          image: "traefik:v3.3",
          ports: [{
            containerPort: 80,
            name: "web",
          }, {
            containerPort: 443,
            name: "websecure",
          }, {
            containerPort: 8080,
            name: "dashboard",
          }],
          volumeMounts: [{
            mountPath: "/etc/traefik",
            name: traefikConfigMap.name,
          }],
        }],
      },
      webPort: 8080,
    });

    new IngressRoute(this, {
      name: "pve",
      service: {
        name: "traefik-external",
        port: 80,
      },
      ingressRouteSpec: {
        customHostPrefix: "pve",
        useForwardAuth: false,
        useInsecureTransport: true,
      },
    });

    new IngressRoute(this, {
      name: "truenas",
      service: {
        name: "traefik-external",
        port: 80,
      },
      ingressRouteSpec: {
        customHostPrefix: "truenas",
        useForwardAuth: false,
        useInsecureTransport: true,
      },
    });
  }
}

const app = new Lab53App();
new TraefikExternal(app, "traefik-external");
app.synth();
