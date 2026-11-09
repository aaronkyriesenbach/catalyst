import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { cidrOf, vlansOf } from "@catalyst/core/network";
import { site } from "@catalyst/site";
import {
  omniInfraPrivileges,
  poolId,
  sdnVnetId,
  storageIds,
  sdnZoneId,
} from "@catalyst/infra/proxmox-names";
import { proxmoxProvider } from "@catalyst/infra/proxmox-provider";

const config = new pulumi.Config();
const [firstNode] = site.proxmox.nodes;

if (firstNode === undefined) {
  throw new Error("site.proxmox.nodes is empty");
}

const provider = proxmoxProvider(config);
const opts = { provider };
const nodeNames = site.proxmox.nodes.map((node) => node.name);

new proxmox.cluster.Options(
  "datacenter",
  {
    keyboard: "en-us",
    language: "en",
    console: "xtermjs",
    description: "Lab Proxmox VE cluster, managed by Pulumi (infra/proxmox).",
  },
  opts,
);

for (const node of nodeNames) {
  new proxmox.apt.Repository(
    `${node}-enterprise`,
    {
      node,
      filePath: "/etc/apt/sources.list.d/pve-enterprise.sources",
      index: 0,
      enabled: false,
    },
    opts,
  );
  new proxmox.apt.Repository(
    `${node}-no-subscription`,
    {
      node,
      filePath: "/etc/apt/sources.list.d/pve-no-subscription.sources",
      index: 0,
      enabled: true,
    },
    opts,
  );
}

new proxmox.storage.Directory(
  storageIds.images,
  {
    resourceId: storageIds.images,
    path: "/var/lib/talos-images",
    contents: ["import", "iso"],
    nodes: nodeNames,
    shared: false,
  },
  opts,
);

new proxmox.storage.Nfs(
  storageIds.backups,
  {
    resourceId: storageIds.backups,
    server: site.nas.ip,
    export: `${site.nas.path}/pve-backups`,
    contents: ["backup"],
    nodes: nodeNames,
  },
  opts,
);

const zone = new proxmox.sdn.zone.Vlan(
  sdnZoneId,
  { resourceId: sdnZoneId, bridge: "vmbr0", nodes: nodeNames },
  opts,
);

const vnets = vlansOf(site.network.vlans).map(
  (vlan) =>
    new proxmox.sdn.Vnet(
      sdnVnetId(vlan.name),
      {
        resourceId: sdnVnetId(vlan.name),
        zone: zone.resourceId,
        tag: vlan.id,
        alias: vlan.description.slice(0, 64),
      },
      opts,
    ),
);

new proxmox.sdn.Applier("sdn", {}, { ...opts, dependsOn: [zone, ...vnets] });

new proxmox.PoolLegacy(poolId, { poolId, comment: "Omni cluster VMs." }, opts);

const omniInfraRole = new proxmox.RoleLegacy(
  "omni-infra",
  { roleId: "OmniInfraProvider", privileges: [...omniInfraPrivileges] },
  opts,
);

const omniInfraPassword = new random.RandomPassword("omni-infra-password", {
  length: 32,
  special: false,
});

const omniInfraUser = new proxmox.UserLegacy(
  "omni-infra",
  {
    userId: "omni-infra@pve",
    comment: "Omni Proxmox infrastructure provider.",
    password: omniInfraPassword.result,
  },
  opts,
);

for (const path of ["/vms", "/storage", "/sdn/zones", "/nodes", "/pool"]) {
  new proxmox.Acl(
    `omni-infra-${path.replaceAll("/", "-")}`,
    {
      path,
      roleId: omniInfraRole.roleId,
      userId: omniInfraUser.userId,
      propagate: true,
    },
    opts,
  );
}

new proxmox.backup.Job(
  "omni-vms",
  {
    resourceId: "omni-vms",
    schedule: "*-*-* 02:00",
    storage: storageIds.backups,
    mode: "snapshot",
    compress: "zstd",
    pool: poolId,
    pruneBackups: { "keep-daily": "7", "keep-weekly": "4" },
  },
  opts,
);

if (config.getBoolean("enableFirewall") === true) {
  const adminSources = site.network.adminNetworks.map((cidr) =>
    cidr.replace(/\/32$/, ""),
  );
  const omniCidr = cidrOf(site.omni.vlan);

  const clusterFirewall = new proxmox.cluster.FirewallLegacy(
    "datacenter-firewall",
    { enabled: true, inputPolicy: "DROP", outputPolicy: "ACCEPT" },
    opts,
  );

  new proxmox.firewall.RulesLegacy(
    "datacenter-rules",
    {
      rules: [
        ...adminSources.map((source) => ({
          type: "in",
          action: "ACCEPT",
          proto: "tcp",
          dport: "8006,22",
          source,
          comment: "Administrator workstation",
        })),
        {
          type: "in",
          action: "ACCEPT",
          proto: "tcp",
          dport: "8006",
          source: omniCidr,
          comment: "Omni infrastructure provider",
        },
      ],
    },
    { ...opts, dependsOn: [clusterFirewall] },
  );
}

export const proxmoxUrl = pulumi.interpolate`https://${firstNode.ip}:8006/api2/json`;
export const omniInfraUserId = omniInfraUser.userId;
export const omniInfraUserPassword = pulumi.secret(omniInfraPassword.result);
export const imagesStorage = storageIds.images;
export const vnetIds = vlansOf(site.network.vlans).map((vlan) =>
  sdnVnetId(vlan.name),
);
