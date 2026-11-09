# Omni cluster infrastructure

Pulumi (TypeScript on Bun) builds a Talos cluster on Proxmox that runs Omni, then Omni manages every other cluster. The cluster is deliberately independent of cluster0: nothing here pulls through the zot mirror or depends on its Traefik.

Addresses, VLANs and hostnames all come from `site.ts` (`site.network`, `site.omni`, `site.proxmox`); `packages/core/network.ts` makes a wrong plan fail `bun run typecheck`.

## Projects

| Order | Project (stack `prod`) | Path                           | What it owns                                               |
| ----- | ---------------------- | ------------------------------ | ---------------------------------------------------------- |
| 1     | `lab-unifi`            | `infra/unifi`                  | Lab VLANs, firewall zones and the inter-zone policies.     |
| 2     | `lab-proxmox`          | `infra/proxmox`                | PVE datacenter config, storage, SDN VNets, users, backups. |
| 3     | `omni-cluster`         | `clusters/omni/infra/cluster`  | Talos VMs, Talos config, Cilium, Gateway API CRDs.         |
| 4     | `omni-platform`        | `clusters/omni/infra/platform` | LB pool, cert-manager, Gateway, DNS, Dex, AWS, Omni.       |
| 5     | `omni-config`          | `clusters/omni/infra/config`   | Omni service accounts and the Proxmox infra provider.      |

Run Pulumi through mise until it is in your global config: `mise x pulumi@3.274.1 -- pulumi up`.

## One-time setup

```sh
bun install
mise x pulumi@3.274.1 -- pulumi login          # Pulumi Cloud, free plan
```

Do `infra/proxmox/bootstrap/README.md` first. Then per project, `pulumi stack init prod` and set the secrets:

| Project         | Secret config                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `lab-unifi`     | `unifi:apiKey` (a new UniFi API key)                                                              |
| `lab-proxmox`   | `apiToken` (`pulumi@pve!automation=...`)                                                          |
| `omni-cluster`  | `apiToken` (same token), `unifi:apiKey`                                                           |
| `omni-platform` | `cloudflareApiToken` (zone-scoped DNS edit), `etcdEncryptionKey`, `unifi:apiKey`, AWS credentials |
| `omni-config`   | none                                                                                              |

Replace the `PLACEHOLDER` values in each `Pulumi.prod.yaml` (`aws:profile`, and `<org>` in the `clusterStack` and `proxmoxStack` references).

```sh
sh clusters/omni/infra/platform/generate-etcd-key.sh |
  mise x pulumi@3.274.1 -- pulumi config set --secret etcdEncryptionKey
```

The key also lands in AWS Secrets Manager (`lab53/omni/omni/etcd-encryption-key`). Losing it loses Omni's data, so keep that copy.

## Bring-up

1. `lab-unifi`, then `lab-proxmox`.
2. `omni-cluster`. Talos boots from the factory image, gets its reserved address, and Pulumi applies the config, bootstraps and installs Cilium. Nodes are `NotReady` until Cilium runs.
3. `omni-platform` with `omniEnabled: "false"`. This brings up the LB pool, cert-manager, the Gateway, DNS and Dex.
4. Choose a storage driver. Omni needs one RWO PVC (`persistence`, 16Gi). Add its module under `platform/`, then set `storageClass` and `omniEnabled: "true"` and run `omni-platform` again.
5. `omni-config`. It reads the initial service-account key out of the Omni pod, creates the Proxmox infrastructure provider and runs it in `omni-infra-provider`. It needs `kubectl` on the workstation.

Log in at `https://omni.int.lab53.net` as `aaron@lab53.net` through Dex. The password is a Pulumi output: `pulumi stack output --show-secrets dexAdminPasswordOutput` in `omni-platform`.

## Verify on first run

- **Talos ingress firewall.** Apply with `--mode=try` if you change it by hand. The rules assume pods reach the API server on the node address (hence the pod and service subnets on `6443`).
- **Cilium Gateway on Talos.** Cilium's L7 proxy needs TPROXY. If connections to the Gateway time out, set `bpf.tproxy=true` in `cluster/cilium.ts`.
- **Gateway address.** `spec.addresses` and the `lbipam.cilium.io/ips` annotation must match the Cilium 1.20 documentation; the pool and L2 policy are in `platform/load-balancer.ts`.
- **Omni etcd listener.** Backups connect to `omni-etcd:2379` over mTLS, which needs `storage.default.etcd.endpoints` to bind a non-loopback address. If Omni refuses `https://0.0.0.0:2379`, change it in `platform/omni.ts`.
- **kubelet-serving-cert-approver** runs in its own namespace under the cluster-wide `restricted` Pod Security default; label that namespace if the pod is rejected.
- **Generated SDK.** `omni-config/sdks/omni` comes from `pulumi package add terraform-provider registry.terraform.io/siderolabs/omni 0.1.0-beta.0`. After regenerating it, change the type-only re-exports in its `index.ts` to `export type` (see `tsconfig.json` and `isolatedModules`).
