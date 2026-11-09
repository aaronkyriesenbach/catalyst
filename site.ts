import {
  allocationsOf,
  type Ipv4Host,
  type NetworkPlan,
} from "@catalyst/core/network";
import type { ImageRegistry } from "@catalyst/versions/versions";

const proxmoxVlan = 10;
const omniVlan = 20;

const vlans = {
  10: {
    name: "lab-mgmt",
    description: "Hypervisor management: Proxmox VE nodes and their API.",
    host: {
      21: { name: "pve1", description: "Proxmox VE node (placeholder)." },
      22: { name: "pve2", description: "Proxmox VE node (placeholder)." },
      23: { name: "pve3", description: "Proxmox VE node (placeholder)." },
    },
  },
  20: {
    name: "omni",
    description:
      "Talos cluster that runs Omni, which manages every other cluster.",
    vip: {
      10: {
        name: "omni-api",
        description: "Kubernetes API address, held by Talos's Layer-2 VIP.",
      },
    },
    host: {
      21: { name: "omni-1", description: "Omni cluster node 1." },
      22: { name: "omni-2", description: "Omni cluster node 2." },
      23: { name: "omni-3", description: "Omni cluster node 3." },
    },
    loadBalancer: {
      50: {
        name: "omni-gateway",
        description:
          "Cilium Gateway: Omni, Dex and the Kubernetes proxy over HTTPS.",
      },
      51: {
        name: "omni-wireguard",
        description: "Omni SideroLink WireGuard endpoint (UDP).",
      },
    },
  },
} as const satisfies NetworkPlan;

export const site = {
  domain: "lab53.net",
  awsSecretsPrefix: "lab53",
  lanCidr: "192.168.0.0/16",
  nas: { ip: "192.168.53.120", path: "/mnt/tank/data" },
  network: {
    vlans,
    adminNetworks: ["192.168.1.40/32"] as const satisfies readonly Ipv4Host[],
  },
  omni: { vlan: omniVlan },
  proxmox: {
    vlan: proxmoxVlan,
    nodes: allocationsOf(vlans, proxmoxVlan, "host").map(({ name, ip }) => ({
      name,
      ip,
    })),
  },
  mirror: {
    host: "zot.int.lab53.net",
    prefixes: {
      "docker.io": "docker",
      "ghcr.io": "ghcr",
      "quay.io": "quay",
      "registry.k8s.io": "k8s",
      "docker.dragonflydb.io": "dragonfly",
    } satisfies Record<ImageRegistry, string>,
  },
  cloudflareZoneId: "6383809236b97157242971dbb4160888",
  defaultContainerResources: {
    requests: { cpu: "10m", memory: "64Mi" },
    limits: { cpu: "1", memory: "512Mi" },
  },
} as const;
