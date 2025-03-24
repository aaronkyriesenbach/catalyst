import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Ocis as OCISChart } from "./imports/ocis.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class OCIS extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    new OCISChart(this, "ocis", {
      namespace: "ocis",
      releaseName: "ocis",
      values: {
        externalDomain: "ocis.lab53.net",
        insecure: {
          ocisHttpApiInsecure: true,
        },
      },
    });

    new IngressRoute(this, "ingress", {
      appName: "proxy",
      customHostPrefix: "ocis",
      customPort: 9200,
      useForwardAuth: false,
    });
  }
}

const app = new App();
new OCIS(app, "ocis");
app.synth();
