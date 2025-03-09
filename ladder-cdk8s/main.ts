import { Construct } from 'constructs';
import { App, Chart } from 'cdk8s';

import BasicApp from '../shared/BasicApp';

export class Ladder extends Chart {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        new BasicApp(this, 'app',
            {
                containers: [{
                    image: "ghcr.io/everywall/ladder:latest",
                    ports: [{ number: 8080 }]
                }],
                webPort: { port: 8080 }
            }
        )
    }
}

const app = new App();
new Ladder(app, 'ladder');
app.synth();
