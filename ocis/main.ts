import { Construct } from "npm:constructs";
import { App, Chart } from "npm:cdk8s";
import { Ocis as OCISChart } from "./imports/ocis.ts";
import IngressRoute from "../shared/IngressRoute.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";

export class OCIS extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const adminPass = new GeneratedPassword(this, "adminpass", {
      name: "admin-pass",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          password: "$(value)",
          "user-id": crypto.randomUUID(),
        },
      },
    });

    new OCISChart(this, "ocis", {
      namespace: "ocis",
      releaseName: "ocis",
      values: {
        externalDomain: "ocis.lab53.net",
        secretRefs: {
          adminUserSecretRef: adminPass.name,
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
