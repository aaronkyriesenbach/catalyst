import * as pulumi from "@pulumi/pulumi";
import { stringify } from "yaml";

type TalosDocument = {
  readonly apiVersion: "v1alpha1";
  readonly kind: string;
} & Readonly<Record<string, unknown>>;

export type Port = number | `${number}-${number}`;

export type FirewallRule = {
  readonly name: string;
  readonly ports: readonly Port[];
  readonly protocol: "tcp" | "udp";
  readonly sources: readonly string[];
};

const toYaml = (value: Readonly<Record<string, unknown>>): string =>
  stringify(value);

const document = (
  kind: string,
  fields: Readonly<Record<string, unknown>>,
): string => toYaml({ apiVersion: "v1alpha1", kind, ...fields });

export function disableFlannel(): string {
  return toYaml({
    apiVersion: "v1alpha1",
    kind: "KubeFlannelCNIConfig",
    $patch: "delete",
  } satisfies TalosDocument);
}

export function disableKubeProxy(): string {
  return document("KubeProxyConfig", { enabled: false });
}

export function ingressFirewall(rules: readonly FirewallRule[]): string[] {
  return [
    document("NetworkDefaultActionConfig", { ingress: "block" }),
    ...rules.map((rule) =>
      document("NetworkRuleConfig", {
        name: rule.name,
        portSelector: { ports: [...rule.ports], protocol: rule.protocol },
        ingress: rule.sources.map((subnet) => ({ subnet })),
      }),
    ),
  ];
}

export type ClusterPatchInput = {
  readonly installImage: pulumi.Input<string>;
  readonly podSubnet: string;
  readonly serviceSubnet: string;
  readonly apiVip: string;
  readonly controlPlane: boolean;
};

// `restricted` by default: Talos ships `baseline`, and only kube-system is exempt.
const podSecurityAdmission = {
  name: "PodSecurity",
  configuration: {
    apiVersion: "pod-security.admission.config.k8s.io/v1alpha1",
    kind: "PodSecurityConfiguration",
    defaults: {
      enforce: "restricted",
      "enforce-version": "latest",
      audit: "restricted",
      "audit-version": "latest",
      warn: "restricted",
      "warn-version": "latest",
    },
    exemptions: {
      usernames: [],
      runtimeClasses: [],
      namespaces: ["kube-system"],
    },
  },
};

// virtio NIC names depend on the PCI slot, so the legacy deviceSelector is used instead of Layer2VIPConfig's link name.
export function nodePatch(input: ClusterPatchInput): pulumi.Output<string> {
  const nic: Record<string, unknown> = {
    deviceSelector: { physical: true },
    dhcp: true,
  };

  if (input.controlPlane) {
    nic.vip = { ip: input.apiVip };
  }

  return pulumi.output(input.installImage).apply((image) =>
    toYaml({
      machine: {
        install: { image, wipe: false },
        network: { interfaces: [nic] },
        kubelet: { extraArgs: { "rotate-server-certificates": "true" } },
      },
      cluster: {
        allowSchedulingOnControlPlanes: true,
        network: {
          podSubnets: [input.podSubnet],
          serviceSubnets: [input.serviceSubnet],
        },
        apiServer: { admissionControl: [podSecurityAdmission] },
      },
    }),
  );
}
