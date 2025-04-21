import { Construct } from "npm:constructs";
import { PodSpecProps } from "./k8s/Pod.ts";
import { ServiceSpec } from "./imports/k8s.ts";
import IngressRoute, { IngressRouteSpec } from "./traefik/IngressRoute.ts";
import Deployment from "./k8s/Deployment.ts";
import Service from "./k8s/Service.ts";

export default class Application extends Construct {
  constructor(scope: Construct, props: ApplicationProps) {
    super(scope, crypto.randomUUID());

    const { name, podSpecProps, webPort, serviceSpec, ingressRouteSpec } =
      props;

    new Deployment(this, {
      name: name,
      podSpecProps: podSpecProps,
    });

    const ports = podSpecProps.containers.map((c) => c.ports).flat().filter(
      (p) => p != null,
    );

    if (ports) {
      new Service(this, {
        name: name,
        serviceSpec: {
          ...serviceSpec,
          ports: ports.map((p) => ({
            port: p.containerPort,
            name: p.name,
          })),
        },
      });
    }

    if (webPort) {
      new IngressRoute(this, {
        name: name,
        service: {
          name: name,
          port: webPort,
        },
        ingressRouteSpec: ingressRouteSpec,
      });
    }
  }
}

export type ApplicationProps = {
  name: string;
  podSpecProps: PodSpecProps;
  webPort?: number;
  serviceSpec?: ServiceSpec;
  ingressRouteSpec?: IngressRouteSpec;
};
