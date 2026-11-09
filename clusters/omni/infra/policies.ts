import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

type Rule = Readonly<Record<string, unknown>>;

export type CiliumPolicySpec = {
  readonly endpointSelector?: Rule;
  readonly ingress?: readonly Rule[];
  readonly egress?: readonly Rule[];
};

export const dnsEgress: Rule = {
  toEndpoints: [
    {
      matchLabels: {
        "k8s:io.kubernetes.pod.namespace": "kube-system",
        "k8s:k8s-app": "kube-dns",
      },
    },
  ],
  toPorts: [{ ports: [{ port: "53", protocol: "ANY" }] }],
};

export const apiServerEgress: Rule = { toEntities: ["kube-apiserver"] };

export const internetEgress = (ports: readonly number[]): Rule => ({
  toEntities: ["world"],
  toPorts: [
    {
      ports: ports.map((port) => ({ port: String(port), protocol: "ANY" })),
    },
  ],
});

// Gateway API traffic reaches pods with Cilium's `ingress` identity, which a
// standard NetworkPolicy cannot select.
export const fromGateway = (ports: readonly number[]): Rule => ({
  fromEntities: ["ingress"],
  toPorts: [
    {
      ports: ports.map((port) => ({ port: String(port), protocol: "TCP" })),
    },
  ],
});

export function ciliumPolicy(
  name: string,
  namespace: pulumi.Input<string>,
  spec: CiliumPolicySpec,
  opts: pulumi.CustomResourceOptions,
): k8s.apiextensions.CustomResource {
  return new k8s.apiextensions.CustomResource(
    name,
    {
      apiVersion: "cilium.io/v2",
      kind: "CiliumNetworkPolicy",
      metadata: { name, namespace },
      spec: { endpointSelector: {}, ...spec },
    },
    opts,
  );
}
