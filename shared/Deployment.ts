import { KubeDeployment } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";
import { AppProps } from "./AppProps.ts";
import { getPodSpec } from "./Pod.ts";

export default class Deployment extends KubeDeployment {
  constructor(scope: Construct, id: string, props: AppProps) {
    const {
      appName,
      replicas,
      revisionHistoryLimit,
    } = props;

    super(scope, id, {
      metadata: {
        name: appName,
      },
      spec: {
        selector: { matchLabels: { app: appName } },
        replicas: replicas ?? 1,
        revisionHistoryLimit: revisionHistoryLimit ?? 1,
        template: getPodSpec(props),
      },
    });
  }
}
