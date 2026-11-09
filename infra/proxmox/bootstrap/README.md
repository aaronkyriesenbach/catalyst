# Proxmox bootstrap

Pulumi cannot install or cluster Proxmox VE, and it needs a credential to start. Do this once on the new cluster, then everything else is `infra/proxmox`.

## 1. Install and cluster

1. Install the latest PVE on each node with the management address from `site.proxmox.nodes` (`site.ts`), on the VLAN named `lab-mgmt` (tag and subnet from `site.network.vlans`).
2. Create the cluster (`pvecm create` on the first node, `pvecm add` on the others).
3. Make `vmbr0` VLAN-aware on every node (`bridge-vlan-aware yes`, `bridge-vids 2-4094` in `/etc/network/interfaces`) and trunk the VLANs to the switch ports. The provider cannot manage host network files.

## 2. Credentials

On any node, as root:

```sh
sh pve-bootstrap.sh
```

It creates the `pulumi@pve` user with a role that covers everything `infra/proxmox` manages, prints the API token once, and adds the no-subscription apt source that Pulumi then enables.

```sh
cd infra/proxmox
mise x pulumi@3.274.1 -- pulumi stack init prod
mise x pulumi@3.274.1 -- pulumi config set --secret apiToken 'pulumi@pve!automation=<secret>'
```

Pulumi also needs SSH to the nodes for snippets and disk import: load a key that can log in as `lab-proxmox:sshUser` into your agent (`ssh-add`).

## 3. TrueNAS

Create the NFS export `<site.nas.path>/pve-backups` (dataset `pve-backups`) and allow the PVE management addresses. Pulumi defines the `nas-backups` storage on top of it.

## 4. Firewall

`lab-proxmox:enableFirewall` stays `false` for the first apply. Turn it on only once the admin address in `site.network.adminNetworks` reaches `:8006` and `:22`, because a wrong rule locks the datacenter out of its own API.
