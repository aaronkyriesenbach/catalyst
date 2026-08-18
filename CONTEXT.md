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
to avoid Omni managing a cluster it lives inside. Runs as a single VM (embedded etcd), a conscious,
bounded risk acceptance: Omni is not part of the Kubernetes control plane, so an extended outage pauses
GitOps reconciliation and external (`kubectl`) access to either workload cluster, but does not affect
already-running workloads. See ADR 0002, ADR 0012.
_Avoid_: management cluster (Omni is not a Kubernetes cluster)

**Platform cluster**:
The dedicated, HA (3 control-plane nodes) Kubernetes cluster hosting every shared platform service
(observability, secrets-sync, service mesh control plane, database-as-a-service operator, registry,
identity infrastructure, the GitOps hub, etc.) and nothing else — enforced with a taint, not left as
convention. See ADR 0002.

**GitOps hub**:
The single ArgoCD instance, hosted on the platform cluster, that renders every app's TypeScript
config (via its Config Management Plugin) and reconciles it onto all three clusters — the platform
cluster itself plus the External and Internal workload clusters, registered as remote destinations
via cluster `Secret`s containing Omni-issued, per-cluster bearer tokens, auto-minted and renewed by a
platform-cluster `CronJob` (never a manual step). Contrasted with running an independent ArgoCD
instance per cluster (rejected) or an agent-based pull topology (`argocd-agent`, considered and
rejected — reopens the same per-cluster-footprint tradeoff via mTLS instead of cluster `Secret`s).
Every Omni-managed cluster is reachable only through Omni's own WireGuard-tunneled Kubernetes-API
proxy (no native VIP, per #7) — so the hub's ongoing reconciliation of both workload clusters depends
on the Management host's uptime, not just on cluster creation. See ADR 0007, ADR 0011.
_Avoid_: "ArgoCD" alone when the point is the hub-and-spoke topology specifically, not the tool choice

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

**Shared/bulk storage**:
File-oriented data multiple pods may legitimately read/write concurrently, or that's simply large and
cold (media libraries, shared config/state, backups). Backed by `truenas-nfs`, `reclaimPolicy: Retain`.
Contrasted with **Runtime storage**, which has different correctness and lifecycle needs. See ADR 0005.
_Avoid_: "NAS storage" alone (both categories live on the NAS; the distinction is data shape, not
physical location)

**Runtime storage**:
Block storage for a single app's own exclusive-access working data — embedded SQLite-style databases
and Postgres, today via `truenas-iscsi`/`truenas-nvmeof` (RWO only). Never NFS: SQLite and Postgres WAL
are both documented as architecturally incompatible with network-filesystem semantics, not merely slow
on one. Forces Deployment `strategy: Recreate` on restart — accepted as inherent to single-writer
workloads, not solved by any centralized-storage option surveyed (see ADR 0005, research #39). Contrasted
with **Shared/bulk storage**.

**Database-as-a-service**:
The CloudNativePG operator and every app's Postgres `Cluster` CR (its actual pod + PVC) — one fleet,
hosted only on the platform cluster, never duplicated per workload cluster. A workload-cluster app's
database is never co-located with the app; it always crosses the network to reach it, via a CNPG-native
`LoadBalancer` service and `sslmode=verify-full`, provisioned as a sibling `Application` pinned to the
platform cluster. Redis/Valkey is deliberately not part of this term yet — no app uses one, and the
choice is deferred. See ADR 0006, ADR 0010.
_Avoid_: "the Postgres operator" alone once Redis/Valkey is added — qualify which store.

**Workload identity**:
A SPIRE-issued SPIFFE identity (an X.509-SVID or JWT-SVID) proving what a workload *is*, presented to a
relying party (OpenBao, AWS, a peer workload's mTLS, or in future a CNPG-hosted Postgres role) instead of
a static shared secret. One SPIRE trust domain spans all three clusters (platform, External workload,
Internal workload) — not per-cluster federation. Distinct from **human identity** (still deferred, no
provider chosen yet) and from Istio ambient's own same-cluster mTLS identities, which SPIRE does not
replace — ambient's identities never leave ztunnel, so they can't be presented to an external relying
party the way a SPIRE SVID can. See ADR 0014.
_Avoid_: "machine identity" as a formal term once this is the only mechanism in play; fine in casual prose
for contrasting with human identity.

**Secrets store**:
Contrasts two deliberately separate stores. **Bootstrap-layer secrets** (Proxmox/TrueNAS/Unifi
credentials, OpenTofu state) live in AWS Secrets Manager, owned by the bootstrap layer (ADR 0001).
**App-layer secrets** (everything ESO syncs into workload/platform-cluster apps) live in self-hosted
OpenBao on the platform cluster. See ADR 0004.
_Avoid_: using "secrets manager" alone for either — always qualify bootstrap-layer vs. app-layer.
