import { KubeDeployment } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";
import { getPodSpec, PodSpecProps } from "./Pod.ts";

export default class Deployment extends KubeDeployment {
  constructor(scope: Construct, props: DeploymentProps) {
    const { name, podSpecProps, replicas } = props;

    const podSpec = getPodSpec(podSpecProps);

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        selector: { matchLabels: { app: name } },
        replicas: replicas ?? 1,
        revisionHistoryLimit: 1,
        template: {
          metadata: {
            name: name,
            labels: {
              app: name
            }
          },
          spec: podSpec,
        },
      },
    });
  }
}

export type DeploymentProps = {
  name: string;
  podSpecProps: PodSpecProps;
  replicas?: number;
};
