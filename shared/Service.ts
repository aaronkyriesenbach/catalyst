import { Construct } from "npm:constructs";
import { KubeService, ServiceSpec } from "./imports/k8s.ts";

export default class Service extends KubeService {
  constructor(scope: Construct, props: ServiceProps) {
    const { name, serviceSpec } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: {
        ...serviceSpec,
        selector: {
          app: name,
          ...serviceSpec.selector,
        },
      },
    });
  }
}

export type ServiceProps = {
  name: string;
  serviceSpec: ServiceSpec;
};
