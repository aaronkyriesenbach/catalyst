import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import * as command from "@pulumi/command";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";
import * as unifi from "@pulumiverse/unifi";
import { stringify } from "yaml";
import { site } from "@catalyst/site";
import { helmRelease } from "@catalyst/infra/helm";
import { macAddressFor, talosVm } from "@catalyst/infra/proxmox-vm";
import { poolId, sdnVnetId, storageIds } from "@catalyst/infra/proxmox-names";
import { proxmoxProvider } from "@catalyst/infra/proxmox-provider";
import { TalosCluster } from "@catalyst/infra/talos-cluster";
import {
  disableFlannel,
  disableKubeProxy,
  ingressFirewall,
  nodePatch,
} from "@catalyst/infra/talos-patches";
import { infraVersions } from "@catalyst/versions/versions";
import {
  apiVip,
  clusterName,
  kubernetesVersion,
  nodes,
  podSubnet,
  serviceSubnet,
  talosVersion,
} from "../common";
import { ciliumValues } from "./cilium";
import { firewallRules } from "./firewall";

const config = new pulumi.Config();
const provider = proxmoxProvider(config);
const opts = { provider };

const schematic = new talos.imagefactory.Schematic("omni", {
  schematic: stringify({
    customization: {
      systemExtensions: { officialExtensions: ["siderolabs/qemu-guest-agent"] },
    },
  }),
});

const imageUrl = pulumi.interpolate`https://factory.talos.dev/image/${schematic.id}/${talosVersion}/nocloud-amd64.qcow2`;
const installImage = pulumi.interpolate`factory.talos.dev/installer/${schematic.id}:${talosVersion}`;

const images = new Map(
  site.proxmox.nodes.map((node) => [
    node.name,
    new proxmox.download.File(
      `talos-${node.name}`,
      {
        nodeName: node.name,
        datastoreId: storageIds.images,
        contentType: "import",
        url: imageUrl,
        fileName: pulumi.interpolate`talos-${talosVersion}-${schematic.id}.qcow2`,
      },
      opts,
    ),
  ]),
);

const omniNetwork = unifi.getNetworkOutput({ name: "omni" });

const vms = nodes.map((node, index) => {
  const host = site.proxmox.nodes[index % site.proxmox.nodes.length];
  const image = host === undefined ? undefined : images.get(host.name);

  if (host === undefined || image === undefined) {
    throw new Error(`no Proxmox node or image for ${node.name}`);
  }

  const mac = macAddressFor(site.omni.vlan, node.octet);
  const reservation = new unifi.iam.User(node.name, {
    name: node.name,
    mac,
    fixedIp: node.ip,
    networkId: omniNetwork.id,
    note: node.description,
  });

  return talosVm(
    {
      name: node.name,
      node: host.name,
      vmId: site.omni.vlan * 100 + node.octet,
      cores: 4,
      memoryMb: 8192,
      diskGb: 60,
      datastore: storageIds.vmDisks,
      imageFileId: image.id,
      macAddress: mac,
      bridge: sdnVnetId("omni"),
      pool: poolId,
      tags: ["talos", "omni"],
    },
    { ...opts, dependsOn: [reservation] },
  );
});

const cluster = new TalosCluster(
  clusterName,
  {
    clusterName,
    apiVip,
    nodes: nodes.map((node) => ({
      name: node.name,
      ip: node.ip,
      controlPlane: true,
    })),
    talosVersion,
    kubernetesVersion,
    patches: {
      all: [
        disableFlannel(),
        disableKubeProxy(),
        ...ingressFirewall(firewallRules),
      ],
      controlPlane: [],
      node: (node) =>
        nodePatch({
          installImage,
          podSubnet,
          serviceSubnet,
          apiVip,
          controlPlane: node.controlPlane,
        }),
    },
  },
  { dependsOn: vms },
);

const kubernetes = new k8s.Provider("omni", { kubeconfig: cluster.kubeconfig });

const apiReady = new command.local.Command(
  "wait-for-api",
  {
    create: "sh ./wait-for-api.sh",
    dir: import.meta.dirname,
    environment: { KUBECONFIG_DATA: cluster.kubeconfig },
  },
  { dependsOn: cluster.ready },
);

const gatewayApiCrds = new k8s.yaml.v2.ConfigGroup(
  "gateway-api-crds",
  {
    files: [
      "gatewayclasses",
      "gateways",
      "httproutes",
      "referencegrants",
      "grpcroutes",
      "backendtlspolicies",
      "tlsroutes",
    ].map(
      (kind) =>
        `https://raw.githubusercontent.com/${infraVersions.gatewayApiCrds.name}/${infraVersions.gatewayApiCrds.version}/config/crd/standard/gateway.networking.k8s.io_${kind}.yaml`,
    ),
  },
  { provider: kubernetes, dependsOn: [apiReady] },
);

const cilium = helmRelease(
  "cilium",
  {
    chart: "cilium",
    namespace: "kube-system",
    values: ciliumValues,
    skipAwait: true,
  },
  { provider: kubernetes, dependsOn: [gatewayApiCrds] },
);

new k8s.yaml.v2.ConfigFile(
  "kubelet-serving-cert-approver",
  {
    file: `https://raw.githubusercontent.com/${infraVersions.kubeletServingCertApprover.name}/${infraVersions.kubeletServingCertApprover.version}/deploy/standalone-install.yaml`,
  },
  { provider: kubernetes, dependsOn: [cilium] },
);

export const kubeconfig = cluster.kubeconfig;
export const talosconfig = cluster.talosconfig;
export const apiAddress = apiVip;
export const nodeAddresses = nodes.map((node) => node.ip);
