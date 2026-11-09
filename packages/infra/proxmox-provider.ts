import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import * as pulumi from "@pulumi/pulumi";
import { site } from "@catalyst/site";

export function proxmoxProvider(config: pulumi.Config): proxmox.Provider {
  const [firstNode] = site.proxmox.nodes;

  if (firstNode === undefined) {
    throw new Error("site.proxmox.nodes is empty");
  }

  return new proxmox.Provider("pve", {
    endpoint: `https://${firstNode.ip}:8006/`,
    apiToken: config.requireSecret("apiToken"),
    insecure: config.getBoolean("insecure") ?? true,
    ssh: {
      username: config.get("sshUser") ?? "root",
      agent: true,
      nodes: site.proxmox.nodes.map((node) => ({
        name: node.name,
        address: node.ip,
      })),
    },
  });
}
