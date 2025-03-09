import { Construct } from 'constructs';
import { ContainerProps, Deployment, ServicePort } from 'cdk8s-plus-32'
import IngressRoute from "./IngressRoute";

export default class BasicApp extends Construct {
    constructor(scope: Construct, id: string, props: AppProps) {
        super(scope, id);

        const { containers, webPort } = props;

        const deployment = new Deployment(this, 'deployment', {
            containers: containers
        });

        const exposePorts: ServicePort[] = [];
        containers.forEach(c => {
            c.ports && c.ports.forEach(p => {
                exposePorts.push({ port: p.number })
            })
        })

        const service = deployment.exposeViaService({
            ports: exposePorts
        })

        if (webPort) {
            new IngressRoute(this, 'ingress', {
                serviceName: service.name,
                port: webPort.port
            })
        }
    }
}

export type AppProps = {
    containers: ContainerProps[]
    webPort?: ServicePort
}
