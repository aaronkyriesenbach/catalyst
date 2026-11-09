import { cidrOf } from "@catalyst/core/network";
import type { FirewallRule } from "@catalyst/infra/talos-patches";
import { site } from "@catalyst/site";
import { nodes, podSubnet, serviceSubnet } from "../common";

const clusterSubnet = cidrOf(site.omni.vlan);
const controlPlaneHosts = nodes.map((node) => `${node.ip}/32`);

const adminAndCluster = [...site.network.adminNetworks, clusterSubnet];

// Pods reach the API server on the node address, so their subnets need 6443 too.
export const firewallRules: readonly FirewallRule[] = [
  {
    name: "kubelet",
    ports: [10250],
    protocol: "tcp",
    sources: [clusterSubnet],
  },
  {
    name: "apid",
    ports: [50000],
    protocol: "tcp",
    sources: adminAndCluster,
  },
  { name: "trustd", ports: [50001], protocol: "tcp", sources: [clusterSubnet] },
  {
    name: "kubernetes-api",
    ports: [6443],
    protocol: "tcp",
    sources: [...adminAndCluster, podSubnet, serviceSubnet],
  },
  {
    name: "etcd",
    ports: ["2379-2380"],
    protocol: "tcp",
    sources: controlPlaneHosts,
  },
  {
    name: "cilium-vxlan",
    ports: [8472],
    protocol: "udp",
    sources: [clusterSubnet],
  },
  {
    name: "cilium-wireguard",
    ports: [51871],
    protocol: "udp",
    sources: [clusterSubnet],
  },
  {
    name: "cilium-health",
    ports: [4240, 4244],
    protocol: "tcp",
    sources: [clusterSubnet],
  },
];
