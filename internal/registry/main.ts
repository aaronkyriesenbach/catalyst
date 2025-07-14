import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import { Lab53App } from "../../shared/helpers.ts";
import Application from "../../shared/Application.ts";
import { INTERNAL_SUBDOMAIN } from "../../shared/constants.ts";

export class Registry extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new Application(this, {
      name: "registry",
      podSpecProps: {
        containers: [{
          name: "registry",
          image: "registry:latest",
          ports: [{ containerPort: 5000 }],
          env: [{
            name: "REGISTRY_PROXY_REMOTEURL",
            value: "https://registry-1.docker.io",
          }, {
            name: "REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY",
            value: "/var/lib/registry",
          }],
        }],
        nasVolumeMounts: {
          "registry": [{
            mountPath: "/var/lib/registry",
            subPath: "registry",
          }],
        },
      },
      webPort: 5000,
      ingressRouteSpec: {
        subdomain: INTERNAL_SUBDOMAIN,
      },
    });
  }
}

const app = new Lab53App();
new Registry(app, "registry");
app.synth();
