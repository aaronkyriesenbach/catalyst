import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../shared/helpers.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class ArgoConfig extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "argocd" });

    new IngressRoute(this, {
      name: "argocd",
      service: {
        name: "argocd-server",
        port: 443,
      },
      ingressRouteSpec: {
        customHostPrefix: "argo",
        useForwardAuth: false,
        useInsecureTransport: true,
      },
    });
  }
}

const app = new Lab53App();
new ArgoConfig(app, "argoconfig");
app.synth();
