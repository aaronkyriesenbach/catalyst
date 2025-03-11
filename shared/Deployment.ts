import { KubeDeployment } from "./imports/k8s";
import { Construct } from "constructs";
import { AppProps } from "./AppProps";

export default class Deployment extends KubeDeployment {
    constructor(scope: Construct, id: string, props: AppProps) {
        const { appName, replicas, revisionHistoryLimit, containers } = props;

        super(scope, id, {
            metadata: {
                name: appName
            },
            spec: {
                selector: { matchLabels: { app: appName } },
                replicas: replicas ?? 1,
                revisionHistoryLimit: revisionHistoryLimit ?? 1,
                template: {
                    metadata: { labels: { app: appName } },
                    spec: {
                        containers: containers
                    }
                }
            }
        });
    }
}