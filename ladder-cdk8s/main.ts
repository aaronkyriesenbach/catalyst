import { Construct } from 'constructs';
import { App, Chart } from 'cdk8s';

import { Deployment } from "cdk8s-plus-32";
import IngressRoute from "../shared/IngressRoute";

export class Ladder extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const ladderPort = 8080;

        const deployment = new Deployment(this, 'deployment', {
            containers: [{
                image: "ghcr.io/everywall/ladder:latest",
                ports: [{ number: ladderPort }]
            }]
        });

        const service = deployment.exposeViaService({ ports: [{ port: ladderPort }] });

        new IngressRoute(this, 'ingressroute', {
            serviceName: service.name,
            port: ladderPort,
            hostPrefix: 'ladder',
            useInsecureTransport: true
        });
    }
}

const app = new App();
new Ladder(app, 'ladder');
app.synth();
