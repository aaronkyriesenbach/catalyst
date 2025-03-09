import { Construct } from "npm:constructs";
import { AppProps } from "./AppProps.ts";
import { Container, KubeService, ServicePort } from "./imports/k8s.ts";

export default class Service extends KubeService {
    constructor(scope: Construct, id: string, props: AppProps) {
        const { appName, containers = [], initContainers = [] } = props;

        const ports = getPorts([...containers, ...initContainers]);

        super(scope, id, {
            metadata: {
                name: appName
            },
            spec: {
                selector: {
                    app: appName
                },
                ports: ports
            }
        });
    }
}

export function getPorts(containers: Container[]): ServicePort[] {
    const ports: ServicePort[] = [];
    containers?.forEach(c => {
        c.ports?.forEach(p => ports.push({ port: p.containerPort, name: p.name }));
    });

    return ports;
}