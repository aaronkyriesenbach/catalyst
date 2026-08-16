# Homelab Platform

The `catalyst` repo's home-lab Kubernetes platform: physical infrastructure, cluster lifecycle, shared
platform services, and the app-config layer that renders workloads onto it.

## Language

**Bootstrap layer**:
The physical, pre-cluster layer — Proxmox, TrueNAS, and Unifi — provisioned declaratively before any
Kubernetes cluster exists. Owned entirely by OpenTofu (ADR 0001). Ends where the cluster layer begins:
it does not provision individual Kubernetes node VMs.
_Avoid_: physical layer, infra layer (as formal terms; fine in casual prose)

**Cluster layer**:
The Kubernetes node/cluster lifecycle domain — creating, joining, and upgrading Talos node VMs and the
clusters they form, for every cluster (platform, workload, or experimental) alike. Owned entirely by the
cluster-lifecycle tool (Omni), never by the bootstrap layer's OpenTofu.
_Avoid_: node provisioning (as a formal term for the whole layer; fine for describing one act)

**Management host**:
The standalone Proxmox VM/LXC running self-hosted Sidero Omni — the cluster-lifecycle tool itself, not a
Kubernetes cluster. Deliberately kept outside every cluster it manages, including the platform cluster,
to avoid Omni managing a cluster it lives inside. See ADR 0002.
_Avoid_: management cluster (Omni is not a Kubernetes cluster)

**Platform cluster**:
The dedicated, HA (3 control-plane nodes) Kubernetes cluster hosting every shared platform service
(observability, secrets-sync, service mesh control plane, database-as-a-service operator, registry,
identity infrastructure, etc.) and nothing else — enforced with a taint, not left as convention. See
ADR 0002.

**Workload cluster**:
Runs actual apps rendered by `catalyst`'s AppConfig layer, contrasted with the platform cluster, which
runs none. Partitioned by trust boundary into two dedicated clusters — see **External workload cluster**
and **Internal workload cluster**. See ADR 0003.

**External workload cluster**:
The workload cluster holding every externally-reachable app; owns the external-facing gateway and public
DNS entries.
_Avoid_: public cluster

**Internal workload cluster**:
The workload cluster holding every internal-only app; never has a public-ingress-able gateway or public
DNS entry. Still reachable by authorized remote users via the remote-access/tunnel solution (#19), which
extends trusted-network reachability without exposing it publicly — "internal" describes ingress
exposure, not physical LAN-only reachability.
_Avoid_: LAN-only cluster (implies no remote access at all, which is wrong)
