import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { IntOrString } from "../../shared/imports/k8s.ts";

export class Radicale extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "radicale",
      podSpecProps: {
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 2999,
          runAsGroup: 2999,
        },
        nasVolumeMounts: {
          radicale: [{
            mountPath: "/config",
            subPath: "radicale/config",
          }, {
            mountPath: "/data",
            subPath: "radicale/data",
          }],
        },
        containers: [{
          name: "radicale",
          image: "registry.int.lab53.net/tomsquest/docker-radicale:3.5.4.0",
          ports: [{ name: "web", containerPort: 5232 }],
          livenessProbe: {
            httpGet: {
              port: IntOrString.fromNumber(5232),
            },
          },
        }],
      },
      webPort: 5232,
    });
  }
}

const app = new Lab53App();
new Radicale(app, "radicale");
app.synth();
