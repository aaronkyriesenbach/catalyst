import { allocationsOf, ipOf } from "@catalyst/core/network";
import { site } from "@catalyst/site";

const { vlans, adminNetworks } = site.network;

export const mgmtVlan = site.proxmox.vlan;
export const omniVlan = site.omni.vlan;

const omniGateway = ipOf(vlans, omniVlan, "loadBalancer", 50);
const omniWireguard = ipOf(vlans, omniVlan, "loadBalancer", 51);
const omniApi = ipOf(vlans, omniVlan, "vip", 10);

export type ZoneRef = "internal" | "external" | "lab-mgmt" | "omni";

export type PolicyRule = {
  readonly name: string;
  readonly from: ZoneRef;
  readonly to: ZoneRef;
  readonly fromIps?: readonly string[];
  readonly toIps?: readonly string[];
  readonly protocol: "tcp" | "udp" | "all";
  readonly port?: number;
};

const adminIps = adminNetworks.map((cidr) => cidr.replace(/\/32$/, ""));
const pveIps = site.proxmox.nodes.map((node) => node.ip);
const omniNodeIps = [
  omniApi,
  ...allocationsOf(vlans, omniVlan, "host").map((node) => node.ip),
];

const tcpPorts = (
  ports: readonly number[],
  rule: Omit<PolicyRule, "name" | "protocol" | "port">,
  label: string,
): PolicyRule[] =>
  ports.map((port) => ({
    ...rule,
    name: `${label}-${port}`,
    protocol: "tcp",
    port,
  }));

export const policyRules: readonly PolicyRule[] = [
  ...tcpPorts(
    [8006, 22],
    { from: "internal", to: "lab-mgmt", fromIps: adminIps, toIps: pveIps },
    "admin-to-pve",
  ),
  ...tcpPorts(
    [6443, 50000],
    { from: "internal", to: "omni", fromIps: adminIps, toIps: omniNodeIps },
    "admin-to-omni",
  ),
  ...tcpPorts(
    [443],
    { from: "internal", to: "omni", toIps: [omniGateway] },
    "lan-to-omni-gateway",
  ),
  {
    name: "lan-to-omni-wireguard-50180",
    from: "internal",
    to: "omni",
    toIps: [omniWireguard],
    protocol: "udp",
    port: 50180,
  },
  ...tcpPorts(
    [8006],
    { from: "omni", to: "lab-mgmt", toIps: pveIps },
    "omni-to-pve-api",
  ),
  ...tcpPorts(
    [2049, 111],
    { from: "lab-mgmt", to: "internal", toIps: [site.nas.ip] },
    "pve-to-nas",
  ),
  { name: "omni-to-internet", from: "omni", to: "external", protocol: "all" },
  {
    name: "lab-mgmt-to-internet",
    from: "lab-mgmt",
    to: "external",
    protocol: "all",
  },
];
