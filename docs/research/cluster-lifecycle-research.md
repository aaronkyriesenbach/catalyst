# Research: Multi-cluster provisioning/lifecycle tooling

Ticket: [#6](https://github.com/aaronkyriesenbach/catalyst/issues/6), part of the
"Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

## Question

Survey multi-cluster Kubernetes provisioning/lifecycle tooling suited to spinning up
reproducible experimental clusters quickly, on a small and growing homelab hardware
footprint (currently 2 Proxmox VE nodes, more planned). Kubernetes-native tooling is
preferred over Cluster API specifically, though CAPI is evaluated as one option among
others. For each tool: how does node addition/replacement work, and how do Kubernetes
version upgrades work in practice?

## Constraints considered

- Single operator, homelab scale.
- Free-tier-first; paid is fine only with clear justification.
- Current state: plain k3s, 2 control-plane+etcd nodes, hand-provisioned, no CAPI.
- Proxmox VE is the hypervisor.
- Hardware will grow and be replaced with more powerful nodes over time.

---

## Cluster API (CAPI)

**What it is.** CAPI models Kubernetes cluster lifecycle as Kubernetes custom resources
running in a "management cluster": `Cluster`, `Machine`, `MachineDeployment`,
`MachineSet`, `MachineHealthCheck`, plus provider-specific `InfraCluster`/`InfraMachine`
and a `ControlPlane` provider (usually `KubeadmControlPlane`). Infrastructure providers
(AWS, vSphere, Proxmox, etc.) implement the provider contract to actually create VMs/hosts.
Source: [Cluster API Book — Concepts](https://cluster-api.sigs.k8s.io/user/concepts.html).

**Node addition/replacement.** Machines are treated as immutable: CAPI never mutates a
running Machine's infrastructure, it only creates or deletes Machines. `MachineDeployment`
is the recommended way to manage a group of worker Machines — changing the
`MachineTemplate` triggers a rolling replacement, analogous to a Kubernetes `Deployment`
rolling out Pod changes. `MachineHealthCheck` can auto-remediate (replace) Machines that
go unhealthy, but only if they're owned by a `MachineSet`. As of CAPI v1.12, an
opt-in "in-place update" extension point exists for scenarios where full replacement
is undesirable, but replace-by-default remains the model.
Source: [Cluster API Book — Concepts, Machine Immutability](https://cluster-api.sigs.k8s.io/user/concepts.html).

**Kubernetes version upgrades.** Two-part process:
1. Control plane: bump `KubeadmControlPlane.spec.version` (and, if the infra provider
   pins a specific machine image per K8s version, update the `MachineTemplate` in the
   same change). This triggers a rolling upgrade of control-plane Machines.
2. Workers: bump the referenced `MachineTemplate` on each `MachineDeployment`, which
   triggers a further rolling replacement (`RollingUpdate` or `OnDelete` strategy).
   A `spec.rollout.after` timestamp can additionally force a rollout (e.g. for cert
   rotation) even with no spec changes.
Source: [Cluster API Book — Upgrading management and workload clusters](https://cluster-api.sigs.k8s.io/tasks/upgrading-clusters.html).

**Proxmox provider — `cluster-api-provider-proxmox` (CAPMOX).** Maintained by IONOS
Cloud, Apache-2.0, actively developed (470 GitHub stars, commits within the last day
as of this research). Provisions VMs on Proxmox VE by cloning a pre-built template
(built with `image-builder`'s Proxmox provider), placing them per `ALLOWED_NODES`,
allocating IPs (static, via the in-cluster IPAM provider, or DHCP), and joining them
via kubeadm bootstrap. Uses `kube-vip` for the control-plane endpoint VIP. Requires a
dedicated Proxmox API token and, ideally, an IPAM provider (`cluster-api-ipam-provider-in-cluster`).
Node add/replace and K8s upgrades follow the generic CAPI model described above — CAPMOX
just supplies the VM lifecycle underneath `InfraMachine`/`InfraCluster`.
Source: [`cluster-api-provider-proxmox` README](https://github.com/ionos-cloud/cluster-api-provider-proxmox) and
[Usage guide](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/main/docs/Usage.md).

**Fit for this homelab.** CAPI's management-cluster model is designed for fleets, and
its immutable-Machine philosophy is a very good match for "reproducible experimental
clusters" — a `clusterctl generate cluster` + `kubectl apply` gives you a disposable,
declarative cluster, and deleting the `Cluster` object tears everything down cleanly.
The cost is operational complexity: you need a running management cluster, a Proxmox
API token/RBAC setup, a prebuilt Proxmox template per Kubernetes version (via
`image-builder`), and IPAM. This is real complexity relative to the current
hand-provisioned k3s, but CAPMOX is a maintained, purpose-built provider, and it is
the closest thing to "official" multi-cluster lifecycle tooling on Proxmox — other
options generally use CAPI too (see k0smotron, below) or don't target Proxmox
specifically at all.

---

## Talos Linux + Sidero Omni

**Talos Linux.** An immutable, API-managed Linux distribution built specifically to run
Kubernetes: no SSH, no shell, all configuration and operations happen over a gRPC API
(`talosctl`). Source: [What is Talos Linux?](https://www.talos.dev/v1.9/introduction/what-is-talos/).

**Node addition/replacement.** New nodes boot the Talos image, get a machine config
applied over the API (or via Omni), and join the cluster; there is no "day 2"
configuration drift because the OS is immutable/declarative. A worker or control-plane
node is "replaced" simply by wiping/reprovisioning it and applying config again —
this is the normal Talos workflow, not a special case.

**Talos OS upgrades.** `talosctl upgrade` (or Omni's upgrade flow) points a node at a
new Talos installer image. Talos uses an A/B image scheme: it keeps the previous
kernel/OS image, and if the new image fails to boot it automatically rolls back; manual
rollback is also available via `talosctl rollback`. The upgrade sequence cordons and
drains the node, cleanly leaves etcd membership if it's a control-plane node (verifying
etcd stays quorate first), performs the OS upgrade, reboots, then rejoins and uncordons.
Talos will refuse to upgrade a control-plane node if doing so would break etcd quorum,
and serializes control-plane upgrades so only one node upgrades at a time. Talos OS
upgrades are decoupled from Kubernetes version upgrades (since Talos v1.0).
Source: [Upgrading Talos Linux](https://www.talos.dev/v1.9/talos-guides/upgrading-talos/).

**Kubernetes version upgrades.** Handled separately via `talosctl upgrade-k8s`, which
automates the whole process: pre-pulls new component images, patches each control-plane
node's static pod images (API server, controller-manager, scheduler), updates the
kube-proxy DaemonSet, updates kubelet on every node, re-applies bootstrap/inline/extra
manifests, and (Talos v1.13+) prunes stale resources. It's restartable if interrupted.
A `--dry-run` flag previews the change set.
Source: [Upgrading Kubernetes (Talos)](https://www.talos.dev/v1.9/kubernetes-guides/upgrading-kubernetes/).

**Sidero Omni.** A management plane (SaaS or self-hosted) purpose-built for Talos
clusters: automates cluster creation, scaling, and OS+Kubernetes upgrades across
bare metal, VMs, cloud, and edge, with a wireguard-encrypted control channel
(SideroLink) to every managed node — useful across NATs, which matters for a home
network. Explicitly positions single-node and hybrid clusters (mixing e.g. on-prem
and cloud nodes in one cluster) as first-class use cases.
Source: [Omni Documentation — Overview](https://omni.siderolabs.com/).

**Licensing (important).** Omni is released under the Business Source License 1.1.
The license's Additional Use Grant explicitly permits "personal use in a home lab
environment" and non-production/testing use without a commercial license; only use
that supports a customer's actual business/production dependency requires a paid
license. It converts to MPL-2.0 on 2030-08-04 for versions published before then.
Source: [`siderolabs/omni` LICENSE](https://github.com/siderolabs/omni/blob/main/LICENSE).
Self-hosting Omni on your own infra (as opposed to the SaaS) is documented and
supported. Source: [Omni docs — Self Hosted Options](https://omni.siderolabs.com/) (nav: "Self Hosted Options for Running Omni").

**Fit for this homelab.** Talos itself (no Omni) is free (MPL-2.0), Kubernetes-native
in philosophy (API-driven, no config drift, immutable OS), and directly usable on
Proxmox VMs today via the standard Talos image — no CAPI or extra management cluster
required to get value. Omni adds a real UX/automation layer (upgrade orchestration,
scaling, secure remote access) and is free for this exact use case (homelab, non-production)
per its license grant. This combination is a strong, low-friction alternative to CAPI:
you get "reproducible cluster" ergonomics without adopting CAPI's CRD model, and it
scales cleanly as hardware grows (Omni explicitly supports scaling clusters and adding
heterogeneous nodes over time).

---

## Rancher + Fleet

**Rancher.** A multi-cluster Kubernetes management platform: central UI/API, RBAC,
and — relevant here — "provisioning drivers" (cluster drivers for hosted K8s like
EKS/GKE/AKS, and node drivers, historically Docker-Machine-based, for VM infra like
vSphere, AWS, DigitalOcean, Azure, Harvester, Nutanix AOS). There is **no official
Rancher node driver for Proxmox VE** — it is not in Rancher's documented list of
"Launching Kubernetes on New Nodes in an Infrastructure Provider" targets.
Source: [Rancher Manager docs nav](https://ranchermanager.docs.rancher.com/v2.15/rancher-manager)
(sections "About Provisioning Drivers", "Launching Kubernetes on New Nodes in an
Infrastructure Provider"). A community Proxmox node driver exists
([`14f3v/pve-rancher-node-driver`](https://github.com/14f3v/pve-rancher-node-driver))
but is unmaintained/unstarred — not something to depend on.

**Practical Proxmox path.** Without a first-party driver, the standard pattern is:
provision RKE2/k3s nodes yourself on Proxmox VMs (Ansible, cloud-init, or CAPI/CAPMOX),
then **register them as an "existing"/"custom" cluster** in Rancher for centralized
management, RBAC, and monitoring — Rancher becomes an observability/management layer
on top of clusters whose lifecycle is handled elsewhere.

**Node addition/replacement / K8s upgrades (when using Rancher-managed provisioning,
e.g. via a supported node driver or an infra provider Rancher does support).** Rancher
models clusters as "Machine Pools"; changing a pool's node count or K8s version
triggers RKE2/K3s's own rolling-upgrade behavior across the pool. For imported/custom
clusters (the realistic path for Proxmox), Rancher does not drive the underlying
node/version lifecycle at all — that's on whatever provisioned the nodes (e.g. plain
k3s upgrades, or CAPI if CAPMOX was used underneath).

**Fleet.** Rancher's GitOps engine, but usable standalone (no Rancher required).
Two-stage pull architecture: a **Fleet controller** (runs in any standard cluster, no
custom API beyond the Kubernetes API) polls Git repos and turns them into `Bundle`/
`GitRepo` resources; a **cluster agent** runs in each managed/downstream cluster and
pulls `BundleDeployment`s from the controller — all connections originate from the
downstream cluster to the controller, so downstream clusters can sit behind NAT with
no inbound connectivity required (very relevant for a home network with multiple
Proxmox nodes/clusters). Cluster agents don't need an always-on connection; they
resume as soon as connectivity returns.
Source: [Fleet — Architecture](https://fleet.rancher.io/explanations/architecture).

**Fit for this homelab.** Rancher's own provisioning story doesn't help on Proxmox
without an official driver; it's realistically a "manage/observe existing clusters"
layer for this environment rather than a "spin up reproducible clusters" tool. Fleet,
however, is independently useful and license-free (Apache-2.0) as a GitOps layer for
pushing workloads to N experimental clusters regardless of how they were provisioned —
worth adopting on its own merits alongside whichever provisioning tool is chosen,
rather than as a package deal with full Rancher.

---

## Crossplane (cluster-as-resource)

**What it is.** Crossplane extends the Kubernetes API with `Composition`s: a template
that composes several underlying managed resources (e.g. a VM, storage, network policy)
into one higher-level "composite resource" (XR) that users create declaratively.
Source: [Crossplane docs — Compositions](https://docs.crossplane.io/v2.3/composition/compositions/).
This is the general mechanism by which "cluster-as-a-custom-resource" patterns get
built: define a `Composition` whose backing managed resources provision VMs (or call
out to another system) and end up with a running cluster, exposed to users as one
custom resource (e.g. `XCluster`).

**Options for actually provisioning Proxmox VMs or clusters from Crossplane:**
- No official Crossplane provider targets Proxmox VE or wraps Cluster API in an
  actively maintained way. `crossplane-contrib/provider-capi` exists but its last
  commit was 2020-11-29 — effectively unmaintained.
  Source: [GitHub API metadata for `crossplane-contrib/provider-capi`](https://github.com/crossplane-contrib/provider-capi).
- Several small, low-adoption community Crossplane providers for Proxmox exist
  (e.g. `valkiriaaquatica/provider-proxmox-bpg`, 26 stars; `dougsong/provider-proxmoxve`,
  20 stars) but none has the traction or maturity of CAPMOX for Cluster API, and none
  is an official Crossplane project.
- The realistic, well-supported path is `crossplane-contrib/provider-kubernetes`
  (195 stars, actively maintained) to manage *Kubernetes objects across clusters* from
  Crossplane, or `provider-ansible`/`provider-terraform`-style wrapping to call an
  existing tool (Ansible playbook, Terraform module) that does the actual Proxmox VM
  provisioning, with Crossplane just orchestrating/composing the call.

**Node addition/replacement, upgrades.** Fully dependent on whatever backing
managed resources/providers a given `Composition` uses — Crossplane itself has no
opinion on Proxmox VM or Kubernetes version lifecycle; it's a generalized composition
and reconciliation engine, not a Kubernetes distribution or cluster manager.

**Fit for this homelab.** Interesting for expressing "a cluster" as a single
declarative resource *if* you're willing to build (and maintain) your own Composition
around Ansible/Terraform/CAPI — but there's no ready-made, actively maintained
Proxmox-cluster Composition to adopt today. For a single operator, this is meaningfully
more build-it-yourself effort than CAPMOX or Talos/Omni, for no functionality gain
specific to Proxmox. Best treated as a "watch, don't adopt yet" item unless a
maintained provider-capi or provider-proxmox emerges.

---

## kubeadm / k3sup + Ansible or GitOps

**kubeadm.** The upstream, primitive tool for creating a conformant cluster node-by-node
(`kubeadm init` / `kubeadm join`). Upgrades are versioned and must be done one minor
version at a time (no skipping), documented per version pair (e.g. 1.34→1.35).
Source: [Kubernetes docs — Upgrading kubeadm clusters](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-upgrade/).
Node addition = `kubeadm join` on a new machine; replacement = drain, remove, join a
new one. This is the substrate most higher-level tools (CAPI's `KubeadmControlPlane`,
Kubespray, Rancher's RKE) build on.

**k3sup.** A thin, MIT-licensed Go CLI wrapper that gets you from zero to `KUBECONFIG`
with k3s over SSH — `k3sup install`/`k3sup join`. Its free "CE" edition is aimed
squarely at "ideal for experimentation" one-off installs; a paid `k3sup-pro` tier adds
`plan`/`apply` (an IaC/GitOps-style declarative plan file kept in Git, applied in
parallel across many nodes) plus fast uninstall/reset and fleet-wide command execution.
Source: [`k3sup` README](https://github.com/alexellis/k3sup).

**Kubespray.** Ansible (and Vagrant/Docker-wrapped) playbooks that deploy a
"production-ready" HA cluster across bare metal or major clouds; composable network
plugin choice. Widely used, Apache-2.0, 18.6k stars, actively maintained.
Source: [`kubernetes-sigs/kubespray` README](https://github.com/kubernetes-sigs/kubespray).
Node addition/replacement and upgrades are just re-runs of the relevant playbooks
against an updated inventory — very Ansible-idiomatic, but each run touches
already-running nodes in place rather than the CAPI/Talos "replace, don't mutate"
model.

**k3s's own upgrade tooling (directly relevant — this is what you're running today).**
K3s documents two upgrade paths: manual (`docker`/binary swap + restart, or Terraform),
and **automated, Kubernetes-native upgrades via Rancher's `system-upgrade-controller`**
— a small CRD-based controller (`Plan` CRD) that runs upgrade Jobs on selected nodes by
label, with support for cordon/drain and node-eligibility gating. Free, Apache-2.0
(inherits Rancher's license), no additional infrastructure beyond a Job runner in the
cluster itself.
Source: [K3s docs — Upgrades](https://docs.k3s.io/upgrades),
[`rancher/system-upgrade-controller` README](https://github.com/rancher/system-upgrade-controller).

**Quorum caveat for the current setup.** K3s's HA embedded-etcd docs are explicit:
an HA k3s cluster needs an **odd number** of server (control-plane+etcd) nodes for
etcd quorum — for `n` servers, quorum is `(n/2)+1`, and even-sized clusters gain no
fault-tolerance benefit over the next-smaller odd size. The current cluster runs 2
control-plane+etcd nodes, which is not a quorum-safe HA topology (losing either node
loses quorum, same failure tolerance as a single node, and with a bigger blast radius).
This is worth fixing (3 servers, or an external datastore) independent of any tooling
decision.
Source: [K3s docs — High Availability Embedded etcd](https://docs.k3s.io/datastore/ha-embedded).

**Fit for this homelab.** This is the "keep doing roughly what we do now, but make it
reproducible" bucket. Kubespray/Ansible playbooks in Git, or `system-upgrade-controller`
for automated in-place K3s/K8s-version upgrades, are free, Kubernetes-native (the
latter especially — it's just a controller + CRD, no external management plane), and
directly compatible with the current k3s setup with essentially zero migration cost.
The tradeoff versus CAPI/Talos: "reproducible experimental cluster" here means
"re-run a playbook against fresh VMs," not "declare a `Cluster` object and get one" —
more manual glue, but nothing new to learn.

---

## vcluster (virtual clusters)

**What it is.** vCluster provisions fully isolated "tenant clusters" — each with its
own API server, controller-manager, CRDs, and RBAC — virtualized on top of a "control
plane cluster." From the tenant's perspective it's indistinguishable from a real
cluster (kubectl, Helm, Argo, Crossplane all work unmodified against it). The control
plane can run as a pod in an existing Kubernetes cluster (most common), as a
zero-dependency standalone binary on bare metal/VMs, or fully in Docker (`vind`) for
local dev/CI. Apache-2.0 core is free; a paid "Platform" tier adds things like
multi-region management, SSO, private-node auto-provisioning, HA mode, etc. — none of
which are required for a single-operator homelab.
Source: [vCluster docs — What is vCluster?](https://www.vcluster.com/docs/vcluster/introduction/what-are-virtual-clusters).

**Node addition/replacement.** Not really applicable in the traditional sense: with
the default "shared nodes" model, a vcluster's workloads land on the *host* cluster's
existing nodes — there's no separate node fleet to add to or replace. Adding capacity
means adding nodes to the *host* cluster (whatever provisions that — Talos, kubeadm,
CAPI, etc.), not to the vcluster itself. A "private nodes" mode exists for dedicated
per-tenant infrastructure but is a paid-tier feature aimed at regulated/GPU workloads,
not the homelab case.

**Kubernetes version upgrades.** A vcluster's own Kubernetes version is essentially
independent of the host cluster's — you upgrade it by upgrading the vcluster
Helm release/CLI-managed instance to a new version, which is a much lighter operation
than any host-node OS/K8s upgrade (no node draining, no etcd-quorum concerns for the
virtual control plane — though the syncer and any host-level etcd/datastore still has
its own lifecycle).

**Fit for this homelab.** This solves a different problem than the others surveyed:
vcluster gives you many fast, cheap, *logically* isolated "clusters" (near-instant
create/delete, ideal for experimentation, testing config changes, or per-project
sandboxes) without provisioning any new hardware or VMs — genuinely a great match for
"spinning up reproducible experimental clusters quickly" on a small hardware footprint.
It does **not** replace the need for a real underlying cluster-provisioning tool (Talos,
CAPI, kubeadm/Ansible, etc.) for the actual physical/VM node fleet — it's complementary,
layered on top.

---

## Kamaji / k0smotron (hosted control planes)

**Kamaji.** Runs Kubernetes control-plane components (API server, controller-manager,
scheduler, etc.) as Pods in a management cluster instead of on dedicated machines —
a "hosted control plane" (HCP) model. Adds two CRDs: `TenantControlPlane` (the desired
control plane) and `Datastore` (the backing store — etcd, or via `kine`, MySQL/
PostgreSQL/NATS, decoupling you from needing an odd-numbered etcd quorum per cluster).
Claims control planes ready in ~16s and Kubernetes-version rollouts (blue/green) in
~10s. Apache-2.0, actively maintained (2,002 stars).
Source: [`clastix/kamaji` README](https://github.com/clastix/kamaji).

**Kamaji and node lifecycle.** Kamaji explicitly does **not** provision worker nodes
or replace Cluster API — it only manages the control plane, and pairs with CAPI via a
separate `cluster-api-control-plane-provider-kamaji` for full cluster lifecycle
(worker Machines, etc.). Standalone Kamaji requires you to join worker nodes yourself
(e.g. `kubeadm join`, using Konnectivity so worker nodes can live on a different
network than the control plane). So for "add a node," you either bring your own
kubeadm/Ansible glue, or adopt CAPI + the Kamaji control-plane provider (which then
gives you CAPI's node lifecycle model — MachineDeployments, rolling replacement — as
described above, plus CAPMOX for the Proxmox VM layer).
Source: [`clastix/kamaji` README, "Cluster API support"](https://github.com/clastix/kamaji).

**Kubernetes version upgrades (control plane).** A `TenantControlPlane.spec` version
bump triggers Kamaji's blue/green rollout for that tenant's control plane — no node
draining needed since there's no dedicated control-plane machine to drain.

**k0smotron.** Manages k0s (a lightweight Kubernetes distribution) control planes as
pods in a management cluster, similarly to Kamaji, but is built from the ground up as
a **native Cluster API provider**: it can act as CAPI's control-plane, bootstrap, *and*
infrastructure provider simultaneously. Free, Apache-2.0-equivalent license
(source-available, no explicit non-commercial restriction found in repo metadata),
732 GitHub stars, actively maintained (commits within the last day).
Source: [`k0sproject/k0smotron` README](https://github.com/k0sproject/k0smotron).

**k0smotron's Remote Machine Provider — directly relevant to Proxmox.** k0smotron
ships a CAPI infrastructure provider (`RemoteMachine`/`RemoteCluster`) that manages
worker/control-plane nodes over **plain SSH** to any pre-existing VM or bare-metal host
— it doesn't create the machine, just bootstraps k0s onto one you already have running.
This means you can pair k0smotron with hand-provisioned or Terraform/Ansible-provisioned
Proxmox VMs and still get full CAPI-style declarative lifecycle management (Machine
objects, MachineDeployments, health checks) **without needing a Proxmox-specific
infrastructure provider at all** — sidestepping CAPMOX entirely if desired.
Source: [k0smotron docs — Cluster API, Remote Machine Provider](https://docs.k0smotron.io/v2.1.0/capi-remote/).

**Node addition/replacement, K8s upgrades (via CAPI + k0smotron).** Same CAPI model
described in the CAPI section — MachineDeployment rollout for workers,
`K0smotronControlPlane.spec.version` bump for the hosted control plane, blue/green for
the control plane itself.

**Fit for this homelab.** Both are aimed at "cheap, disposable control planes," which
matches "spin up reproducible experimental clusters quickly" well — a Kamaji or
k0smotron `TenantControlPlane`/`Cluster` object gives you a new control plane in
seconds without provisioning dedicated control-plane VMs at all, useful for a
resource-constrained 2-node Proxmox footprint where you don't want 3 dedicated VMs
per experimental cluster just for HA control plane. k0smotron is the more complete
answer for *this environment specifically*, because its Remote Machine Provider gives
a working, low-effort path to real CAPI-driven lifecycle management on Proxmox VMs
today, without waiting on or fully committing to CAPMOX.

---

## Comparison summary

| Tool | Node add/replace model | K8s upgrade model | Proxmox story | License/cost | Maturity |
|---|---|---|---|---|---|
| CAPI + CAPMOX | Replace via MachineDeployment rollout | Bump `KubeadmControlPlane`/`MachineTemplate` version | Purpose-built provider, active | Free (Apache-2.0) | Mature, CAPI mainstream |
| Talos + Omni | Wipe/reprovision node, reapply config | `talosctl upgrade` (OS) + `talosctl upgrade-k8s` (K8s), decoupled | Works directly, no Proxmox-specific glue needed | Talos free; Omni free for homelab (BUSL grant) | Mature, widely adopted |
| Rancher + Fleet | No native Proxmox driver; import externally-provisioned clusters | Delegated to underlying cluster (k3s/RKE2/CAPI) | Weak — no official node driver | Free (Apache-2.0) | Mature but wrong fit for Proxmox provisioning |
| Crossplane | Fully DIY via Composition + unmaintained/community providers | DIY | No maintained official path | Free (Apache-2.0) core | Immature for this use case |
| kubeadm/Kubespray/Ansible + system-upgrade-controller | Re-run playbook / join-drain-join | Playbook re-run, or CRD-driven rolling upgrade (k3s) | Full control, matches current setup | Free | Mature, closest to status quo |
| vcluster | N/A — shares host cluster nodes | Vcluster Helm release upgrade, independent of host | Complementary, not a substitute | Free (core) | Mature, different problem solved |
| Kamaji | DIY join, or CAPI via control-plane provider | Blue/green `TenantControlPlane.spec.version` bump | Needs CAPI(+CAPMOX) or DIY worker join | Free (Apache-2.0) | Mature |
| k0smotron | CAPI MachineDeployment, incl. SSH-only Remote Machine Provider | Blue/green control plane + MachineDeployment rollout for workers | **Works today via SSH, no Proxmox-specific provider needed** | Free | Mature, active |

## Recommendation

For this homelab (single operator, 2-node Proxmox today, growing, "reproducible
experimental clusters quickly," Kubernetes-native preferred over CAPI-specifically):

1. **Short/no-migration-cost win:** keep k3s, but adopt
   `rancher/system-upgrade-controller` for automated, Kubernetes-native version
   upgrades, and fix the etcd quorum topology (move to 3 control-plane+etcd nodes,
   or offload to fewer with an external datastore) — this alone removes a real
   fragility in the current setup at zero new tooling cost.
2. **Best "spin up reproducible experimental clusters" fit:** Talos Linux (free) as
   the node OS for new experimental clusters, optionally with self-hosted Sidero
   Omni (free for homelab under the BUSL Additional Use Grant) for a management UI
   and automated OS/K8s upgrade orchestration. This directly satisfies "Kubernetes-native
   preferred over CAPI" — it needs no management cluster or CRD model, just an
   API-driven OS — while scaling naturally as more/bigger Proxmox nodes are added.
3. **If a CAPI-style declarative "Cluster as a CRD" workflow is wanted anyway**
   (e.g. for GitOps-managed fleets of experimental clusters), evaluate
   **k0smotron's CAPI + Remote Machine Provider** before `cluster-api-provider-proxmox`:
   it gets you the same declarative Machine/MachineDeployment lifecycle over plain SSH
   to Proxmox VMs you provision by any means, without committing to a Proxmox-specific
   infra provider. Fall back to CAPMOX specifically if/when a Proxmox-native provider
   (auto VM creation from templates) becomes worth the added Proxmox-token/IPAM/template
   maintenance.
4. **Layer vCluster on top of whatever real cluster(s) exist** for near-instant,
   free, disposable sandboxes/tenant clusters when the experiment doesn't need its own
   dedicated VMs — this is the fastest and cheapest way to satisfy "quickly" for a
   large fraction of experimentation needs.
5. **Skip for now:** Rancher (no Proxmox provisioning story; only worth it as an
   optional observability layer over clusters provisioned some other way) and
   Crossplane-as-cluster-provisioner (no maintained Proxmox/CAPI provider exists
   today — revisit if that changes).
