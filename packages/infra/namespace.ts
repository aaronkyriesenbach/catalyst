import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export type PodSecurityLevel = "restricted" | "baseline" | "privileged";

export type LockedDownNamespaceArgs = {
  readonly podSecurity: PodSecurityLevel;
  readonly labels?: Readonly<Record<string, string>>;
};

export type LockedDownNamespace = {
  readonly namespace: k8s.core.v1.Namespace;
  readonly name: pulumi.Output<string>;
};

export function lockedDownNamespace(
  name: string,
  args: LockedDownNamespaceArgs,
  opts?: pulumi.CustomResourceOptions,
): LockedDownNamespace {
  const namespace = new k8s.core.v1.Namespace(
    name,
    {
      metadata: {
        name,
        labels: {
          ...args.labels,
          "pod-security.kubernetes.io/enforce": args.podSecurity,
          "pod-security.kubernetes.io/audit": args.podSecurity,
          "pod-security.kubernetes.io/warn": args.podSecurity,
        },
      },
    },
    opts,
  );

  new k8s.networking.v1.NetworkPolicy(
    `${name}-default-deny`,
    {
      metadata: { name: "default-deny", namespace: namespace.metadata.name },
      spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] },
    },
    { ...opts, parent: namespace },
  );

  return { namespace, name: namespace.metadata.name };
}
