import { Construct } from 'npm:constructs';
import { App, Chart } from 'npm:cdk8s';

import Deployment from "../shared/Deployment.ts";
import { AppProps } from "../shared/AppProps.ts";
import Service from "../shared/Service.ts";
import IngressRoute from "../shared/IngressRoute.ts";

export class Ladder extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const appProps: AppProps = {
            appName: "ladder",
            containers: [{
                name: "ladder",
                image: "ghcr.io/everywall/ladder:latest",
                ports: [{ containerPort: 8080 }],
                env: [{
                    name: "RULESET",
                    value: "https://raw.githubusercontent.com/everywall/ladder-rules/main/ruleset.yaml"
                }]
            }]
        }

        new Deployment(this, 'deployment', appProps);

        new Service(this, 'service', appProps);

        new IngressRoute(this, 'ingress', { useInsecureTransport: true, ...appProps });
    }
}

const app = new App();
new Ladder(app, 'ladder');
app.synth();
