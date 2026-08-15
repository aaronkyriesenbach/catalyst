# Research: Kubernetes distribution comparison on non-lifecycle criteria

Ticket: [#37](https://github.com/aaronkyriesenbach/catalyst/issues/37), which blocks
[#7 — Decide the k8s/node distribution, cluster-lifecycle tooling, and upgrade strategy](https://github.com/aaronkyriesenbach/catalyst/issues/7),
part of the ["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

## Question

Compare Kubernetes/node distributions **as distributions**, independent of cluster-lifecycle
tooling: **k3s, RKE2, k0s, Talos Linux, and vanilla kubeadm on a general-purpose Linux base**
(Ubuntu Server/Debian). For each: resource footprint, default bundled components, security
hardening posture, CNI defaults/flexibility, ecosystem/Helm-chart compatibility quirks, official
support model/release cadence/upgrade policy, and ARM/edge support.

## Scope and relationship to prior research

[#6 — Research: multi-cluster provisioning/lifecycle tooling](https://github.com/aaronkyriesenbach/catalyst/issues/6)
(writeup: [`cluster-lifecycle-research.md`](https://github.com/aaronkyriesenbach/catalyst/blob/research/cluster-lifecycle-research/docs/research/cluster-lifecycle-research.md))
already thoroughly covers cluster-lifecycle **mechanics** — node add/replace flows, CAPI,
Talos+Omni upgrade orchestration (`talosctl upgrade` / `upgrade-k8s`, A/B rollback, etcd-quorum
safety), Rancher+Fleet, Crossplane, kubeadm/Kubespray/Ansible, `system-upgrade-controller`,
vcluster, and Kamaji/k0smotron. That material is **not** repeated here; where relevant this
document links back to it instead. This research is purely distro-vs-distro, on the merits of
each distribution itself.

[#20's mesh-implementation research](https://github.com/aaronkyriesenbach/catalyst/blob/research/mesh-impl-research/docs/research/mesh-impl-research.md)
(feeding [#21](https://github.com/aaronkyriesenbach/catalyst/issues/21)) already covered
CNI/service-mesh interplay in detail — it found that Istio's ambient mode and Linkerd both work
without touching the CNI, while Cilium's mTLS ("Mutual Authentication") feature is Beta with an
admittedly incomplete security model and would require migrating the cluster's CNI to Cilium
outright, and recommended Istio ambient primarily to avoid that migration. That analysis is not
re-litigated here; this document only asks how easy each distro makes a CNI swap *in the
abstract*, as an independent input to whichever way #21 ultimately lands (and to a future
architecture where Cilium might be adopted for CNI-level reasons unrelated to mesh).

**Current state** (from `cluster/README.md` and the map's Notes): the repo runs plain k3s across
two Proxmox VE VMs, both control-plane + embedded-etcd, hand-provisioned, on modest specs that are
expected to grow but shouldn't be assumed unconstrained. k3s's bundled Traefik is in place only
because k3s defaults to it — the ingress/routing decision itself is open
([#36](https://github.com/aaronkyriesenbach/catalyst/issues/36)).

---

## k3s

### Resource footprint

Minimum requirements: **server (control-plane+etcd) 2 cores / 2 GB RAM; agent 1 core / 512 MB
RAM.** k3s also publishes a server-sizing guide relating control-plane CPU/RAM to how many agents
it can support (e.g. 2 vCPU/4 GB → 0–350 agents; HA 3-server setups scale ~50% further per node).
Source: [K3s docs — Requirements](https://docs.k3s.io/installation/requirements).
The project's own stated differentiator is architectural, not just a smaller package: "The memory
footprint is reduced primarily by running many components inside of a single process. This
eliminates significant overhead that would otherwise be duplicated for each component." Source:
[`k3s-io/k3s` README](https://raw.githubusercontent.com/k3s-io/k3s/master/README.md).

### Default bundled components

k3s bundles, and starts by default: **containerd + runc**, **Flannel** (CNI, vxlan backend by
default), **CoreDNS**, **Metrics Server**, **Traefik** (ingress, v3 as of K3s ≥ v1.32, with
optional Gateway API support via a `providers.kubernetesGateway.enabled` HelmChartConfig — this is
exactly the mechanism catalyst already uses), **ServiceLB** (formerly Klipper LB, the embedded
LoadBalancer implementation), a **kube-router**-derived NetworkPolicy controller, a
**Helm-controller** for CRD-driven Helm deploys, **local-path-provisioner** (default
StorageClass), and **Kine** (the datastore shim allowing SQLite/MySQL/Postgres/etcd as the
backing store — **embedded SQLite is the single-server default**, embedded etcd activates
automatically in HA). Source: [`k3s-io/k3s` README](https://raw.githubusercontent.com/k3s-io/k3s/master/README.md),
[K3s docs — Networking Services](https://docs.k3s.io/networking/networking-services),
[K3s docs — Cluster Datastore](https://docs.k3s.io/datastore).
Every packaged component (`coredns`, `traefik`, `local-storage`, `metrics-server`, `servicelb`)
can be turned off with `--disable=<name>` at any time, actively uninstalling it and deleting its
manifest; the same manifest-based AddOn mechanism is used for anything else placed in
`/var/lib/rancher/k3s/server/manifests`. Source: [K3s docs — Managing Packaged Components](https://docs.k3s.io/installation/packaged-components).

### Security defaults/hardening posture

k3s runs on a normal, mutable Linux host with standard SSH/package-manager access — nothing is
hardened by default beyond ordinary upstream Kubernetes behavior. Full CIS Kubernetes Benchmark
compliance is a fully manual, documented exercise: the operator must set kernel sysctls, add
`protect-kernel-defaults`/`secrets-encryption` flags, hand-write a Pod Security Admission config
file, hand-write an audit policy file, `chmod 600` the PKI cert files k3s otherwise ships at `644`,
and apply their own NetworkPolicies (k3s's own hardening guide even hands you the exact
`allow-all-*` NetworkPolicy YAML needed just to un-break Traefik/metrics-server once you've locked
the `kube-system` namespace down). Source: [K3s docs — CIS Hardening Guide](https://docs.k3s.io/security/hardening-guide).

### CNI defaults and flexibility

Default is **Flannel**, vxlan backend by default (wireguard-native available for encryption).
Swapping is supported via `--flannel-backend=none` plus installing any CNI of choice (`--disable-network-policy`
is recommended alongside, to avoid the kube-router netpol controller conflicting with the new
CNI's own policy engine). k3s's own docs give plugin-specific caveats: for Cilium specifically,
before running `k3s-killall.sh`/uninstall you must manually delete leftover
`cilium_host`/`cilium_net`/`cilium_vxlan` interfaces and clean cilium iptables rules, or the host
can lose network connectivity when k3s stops. Source: [K3s docs — Basic Network Options](https://docs.k3s.io/networking/basic-network-options).

### Ecosystem/Helm-chart compatibility quirks

The kubeconfig lives at the non-standard `/etc/rancher/k3s/k3s.yaml` (k3s's bundled `kubectl`
defaults to it; any upstream `kubectl`/`helm` binary needs `KUBECONFIG` set or `--kubeconfig`
passed explicitly). Source: [K3s docs — Cluster Access](https://docs.k3s.io/cluster-access).
The containerd socket and config also live under k3s-specific paths rather than the
upstream-standard locations, which is why k3s ships its own private-registry (`registries.yaml`)
and containerd-config-templating mechanism instead of assuming the standard containerd config
file. Source: [K3s docs — Private Registry Configuration](https://docs.k3s.io/installation/private-registry).
Known, documented friction: the embedded Kine/SQL datastore has a 32-bit-signed-integer
(2,147,483,647) revision ceiling on databases created before May 2024 that requires an explicit
schema migration (`KINE_SCHEMA_MIGRATION`) to avoid going read-only; and specific `iptables`
versions (1.6.1–1.8.4, shipped by default on several popular distros) are known-buggy with k3s,
worked around via `--prefer-bundled-bin` or switching to `iptables-legacy`. Source:
[K3s docs — Known Issues](https://docs.k3s.io/known-issues).

### Official support model, release cadence, upgrade/LTS policy

k3s aims to ship a new minor release within **30 days of the matching upstream Kubernetes `.0`
release**, and actively backports fixes to the **three most recent release branches**
(`release-[N]`, `release-[N-1]`, `release-[N-2]`). Source: [`k3s-io/k3s` ROADMAP.md](https://raw.githubusercontent.com/k3s-io/k3s/master/ROADMAP.md).
Installs/upgrades can be pinned to a `stable`, `latest`, or specific-minor release channel.
Source: [K3s docs — Manual Upgrades / Release Channels](https://docs.k3s.io/upgrades/manual).
Upstream Kubernetes itself supports each minor for roughly **14 months** (12 months "standard" +
2 months "maintenance mode," patched monthly), which is the underlying cadence k3s's own branches
track. Source: [Kubernetes — Patch Releases](https://kubernetes.io/releases/patch-releases/).

### ARM/edge support

Official binaries for **x86_64, armhf (32-bit ARM), and arm64/aarch64** — ARM/edge/IoT is an
explicit, named use case in the project's own README ("Great for: Edge, IoT, ... ARM").
Source: [`k3s-io/k3s` README](https://raw.githubusercontent.com/k3s-io/k3s/master/README.md),
[K3s docs — Requirements](https://docs.k3s.io/installation/requirements).

---

## RKE2

### Resource footprint

Minimum requirements: **4 GB RAM, 2 CPUs** (recommended 8 GB/4 CPUs) — roughly double k3s's stated
server minimum. RKE2's own agent-sizing table shows a lower agents-per-server-spec ceiling than
k3s's equivalent table at the same hardware (e.g. 2 vCPU/4 GB → 0–225 agents for RKE2 vs. 0–350
for k3s), consistent with RKE2 carrying more always-on components. Source:
[RKE2 docs — Requirements](https://docs.rke2.io/install/requirements).

### Default bundled components

Default CNI is **Canal** (Flannel for inter-node traffic + Calico for intra-node traffic/network
policy) — Cilium, Calico-only, and Flannel-only are also **bundled, first-class, Helm-chart-managed
options**, a meaningfully richer "batteries-included" CNI menu than k3s's Flannel-or-BYO choice.
Source: [RKE2 docs — Network Options](https://docs.rke2.io/networking/basic_network_options).
**Default ingress is mid-transition as of this research**: RKE2 has long defaulted to
**ingress-nginx**, but upstream `ingress-nginx` was retired in **March 2026**, and starting with
**RKE2 v1.36, Traefik is now the default ingress for new clusters** (existing clusters keep
ingress-nginx across upgrades to avoid breakage; the `ingress-nginx` chart stops receiving updates
and is slated for full removal in v1.37 for community users). RKE2 ships a first-party, detailed
migration guide for moving an existing cluster from ingress-nginx to Traefik. Source:
[RKE2 docs — Requirements banner](https://docs.rke2.io/install/requirements),
[RKE2 v1.36.X Release Notes](https://docs.rke2.io/release-notes/v1.36.X),
[RKE2 docs — Ingress NGINX to Traefik Migration Guide](https://docs.rke2.io/reference/ingress_migration).
This is directly relevant to catalyst's open ingress decision (#36): RKE2's own "default" is not a
stable target right now, it is a distro actively in the middle of changing its answer to the exact
question #36 is asking. CoreDNS and metrics-server are also bundled by default. **No default
storage class/CSI is bundled** — RKE2's own bundled-chart manifest (`chart_versions.yaml`) only
ships storage CSI charts for specific cloud providers (vSphere, Harvester, oVirt), nothing generic
like k3s's `local-path-provisioner`. Source: [`rancher/rke2` `charts/chart_versions.yaml`](https://raw.githubusercontent.com/rancher/rke2/master/charts/chart_versions.yaml).
Datastore: **embedded etcd is the default** (and the only HA-capable embedded option); embedded
SQLite exists but is explicitly labeled **experimental**, unlike k3s where SQLite is the
supported, default single-server choice. Source: [RKE2 docs — Embedded datastore](https://docs.rke2.io/datastore/embedded).

### Security defaults/hardening posture

RKE2's own README states its purpose directly: "RKE2, also known as **RKE Government**, is
Rancher's next-generation Kubernetes distribution... focuses on security and compliance within
the U.S. Federal Government sector," and lists CIS-benchmark defaults, FIPS 140-2, SELinux/MCS,
and routine trivy CVE scanning in its build pipeline as core design goals — not add-ons. Source:
[`rancher/rke2` README](https://raw.githubusercontent.com/rancher/rke2/master/README.md).
Concretely, RKE2 is "designed to be hardened by default" and passes most CIS controls
unmodified; a single `profile: cis` config flag additionally activates: Pod Security Admission at
`restricted` enforce, restrictive built-in-namespace NetworkPolicies, hardened `--audit-log-*`
API-server flags, `protect-kernel-defaults`, and running etcd as a dedicated non-root `etcd`
user/group — i.e. most of what k3s's hardening guide has the operator hand-assemble is a single
flag in RKE2. Source: [RKE2 docs — CIS Hardening Guide](https://docs.rke2.io/security/hardening_guide).
SELinux is a first-class, single-boolean (`selinux: true`) config option (default-on for RPM
installs), with a dedicated container-selinux policy specialization for RKE2's non-standard file
locations. Source: [RKE2 docs — SELinux](https://docs.rke2.io/security/selinux).

### CNI defaults and flexibility

Default Canal, with Cilium/Calico/Flannel all bundled and supported as swap-in alternatives
selected via a single `cni:` config key, each with documented HelmChartConfig customization
recipes (wireguard encryption, kube-proxy replacement, eBPF dataplane, etc.). However, RKE2 is
explicit that the **primary CNI, CNI backend, and cluster/service CIDRs cannot be changed on a
running cluster** — "Choose the CNI... before first start... Switching later is untested and may
leave stale interfaces or routes behind; rebuild the cluster if you need a different CNI."
Source: [RKE2 docs — Network Options](https://docs.rke2.io/networking/basic_network_options).
Multus is available as a bundled secondary-CNI meta-plugin for multi-NIC pod networking.

### Ecosystem/Helm-chart compatibility quirks

Kubeconfig lives at the equally non-standard `/etc/rancher/rke2/rke2.yaml` (same class of friction
as k3s). RKE2's own Known Issues page is considerably longer than k3s's and skews toward
host/OS-integration friction consistent with running on enterprise Linux (RHEL/SLES): firewalld
conflicts with the default Canal networking stack and should be disabled; NetworkManager will
fight the CNI's routing table unless explicitly told to ignore `flannel*`/`cali*`/`vxlan.calico`
interfaces (and `nm-cloud-setup` must be disabled on some RHEL 8.4 images); Calico's VXLAN hits a
kernel checksum-offload bug RKE2 works around by disabling offload by default; and running with a
`cis`/`cis-1.XX` hardening profile enabled produces a NetworkPolicy set restrictive enough that
`ingress-nginx` traffic gets blocked unless the operator adds their own allow-rule. Source:
[RKE2 docs — Known Issues](https://docs.rke2.io/known_issues).

### Official support model, release cadence, upgrade/LTS policy

RKE2 doesn't publish a separate branch-count policy the way k3s's ROADMAP.md does, but its
release-notes navigation currently treats **v1.33 through v1.36 as active/current branches**
(older minors move to a `release-notes-old` archive), mirroring the same set of Kubernetes minors
upstream itself currently maintains, patched at a similar monthly-or-faster cadence (RKE2 shipped
five `v1.36.x` patches within about three months of `v1.36.0`). Source: [RKE2 v1.36.X Release Notes](https://docs.rke2.io/release-notes/v1.36.X),
[Kubernetes — Patch Releases](https://kubernetes.io/releases/patch-releases/).

### ARM/edge support

**x86_64 and arm64/aarch64 only** — no 32-bit ARM, no RISC-V. RKE2 also supports Windows worker
nodes (Calico/Flannel only), which is not relevant to catalyst's Linux/Proxmox estate but is a
real distro-level difference from the rest of this comparison. Source: [RKE2 docs — Requirements](https://docs.rke2.io/install/requirements).

---

## k0s

### Resource footprint

By far the lowest published minimums of the "batteries-included" group: **controller node 1 GB
RAM / 1 vCPU; worker node 0.5 GB / 1 vCPU; combined controller+worker 1 GB / 1 vCPU.** k0s also
publishes *measured* control-plane memory consumption: as low as **~510 MB** with one worker and
no extra pods, scaling to ~600 MB–2.3 GB depending on worker/pod count. Source:
[k0s docs — System Requirements](https://docs.k0sproject.io/stable/system-requirements/).
This is architectural, not just tuning: **k0s controller nodes run no kubelet and no container
engine by default** — the k0s binary supervises Kubernetes control-plane components as "naked"
processes, so a controller-only node carries none of the kubelet/CRI overhead that k3s, RKE2, and
Talos always run on every node (including their control-plane/server nodes). Source:
[k0s docs — Architecture](https://docs.k0sproject.io/stable/architecture/).

### Default bundled components

Default CNI is **kube-router** (bundled alternative: **Calico**); container runtime is
**containerd + runc** by default. Beyond CNI and the control-plane itself, k0s ships **no default
ingress controller, no default LoadBalancer implementation, and no default storage/CSI** — MetalLB,
NGINX Ingress, Traefik Ingress, Rook/Ceph, OpenEBS, and Longhorn are all listed under the docs'
"Extensions" section, i.e. explicitly opt-in Helm-based add-ons, not defaults. Source:
[k0s docs — Networking (CNI)](https://docs.k0sproject.io/v1.36.3+k0s.2/networking/),
[k0s docs — Storage (CSI)](https://docs.k0sproject.io/stable/storage/).
Because k0s explicitly supports a fully network-isolated control plane (no direct IP route from
controllers to the pod network required), it deploys a **Konnectivity** service by default to
proxy API-server-to-kubelet/service traffic — the same mechanism Kubernetes conformance testing
requires, but which k0s treats as a first-class default rather than an opt-in. Source:
[k0s docs — Networking (CNI), Controller-Worker communication](https://docs.k0sproject.io/v1.36.3+k0s.2/networking/).
Datastore: etcd by default, but via **kine**, k0s also supports MySQL, PostgreSQL, SQLite, and
dqlite as alternative backing stores. Source: [k0s docs — Architecture](https://docs.k0sproject.io/stable/architecture/).

### Security defaults/hardening posture

A middle ground between k3s and RKE2/Talos: k0s's own `kube-bench` (CIS Kubernetes Benchmark)
results page states "By default, k0s will pass Kube-bench benchmarks with some exceptions" — the
documented exceptions are mostly audit-log configuration, encryption-at-rest configuration, and
`EventRateLimit`, each explicitly left to the operator "for sake of simplicity," not because
they're unsupported. Two checks (kubelet service-file permissions/ownership) are marked
not-applicable because **k0s does not use a kubelet service file at all**. Source:
[k0s docs — Kube-bench Security Benchmark](https://docs.k0sproject.io/v1.36.3+k0s.2/cis_benchmark/).
SELinux is supported but fully manual (operator runs `semanage`/`restorecon` and edits a
containerd toml snippet by hand) — there is no single hardening-profile flag equivalent to RKE2's
`profile: cis`. Source: [k0s docs — SELinux](https://docs.k0sproject.io/v1.36.3+k0s.2/selinux/).

### CNI defaults and flexibility

Default kube-router (standard Linux networking + BGP, no overlay required, ~15% lighter resource
use per k0s's own docs, no Windows support); Calico is offered as a bundled alternative (VXLAN by
default, heavier, Windows-capable). A fully custom CNI is supported via a `custom` provider type
(bring your own manifests/Helm), or CNI management can be disabled entirely. As with RKE2, k0s is
explicit that **"once you initialize the cluster with a network provider the only way to change
providers is through a full cluster redeployment."** Source: [k0s docs — Networking (CNI)](https://docs.k0sproject.io/v1.36.3+k0s.2/networking/).

### Ecosystem/Helm-chart compatibility quirks

The "naked process" control-plane model is the standout gotcha: there is **no kubelet systemd
unit** on a k0s host (confirmed by k0s's own kube-bench doc explicitly skipping the
kubelet-service-file checks as not-applicable), which breaks any generic hardening/compliance
tooling or Helm chart that assumes a systemd kubelet unit it can restart or introspect. Source:
[k0s docs — Kube-bench Security Benchmark](https://docs.k0sproject.io/v1.36.3+k0s.2/cis_benchmark/).
Relatedly, **controller-only nodes run no container engine by default**, so any DaemonSet or
Helm chart that assumes every node in the cluster (including control-plane nodes) runs a
container runtime will not schedule/pull images there unless the controller is explicitly also
configured as a worker. Source: [k0s docs — Architecture](https://docs.k0sproject.io/stable/architecture/).

### Official support model, release cadence, upgrade/LTS policy

k0s has explicitly followed **the upstream Kubernetes release-and-support model since k0s 1.21**:
each k0s minor is maintained for the same **~14 months** as its matching upstream Kubernetes
minor, with k0s's own patch releases layered on top and reflected in the version string
(`vX.Y.Z+k0s.N`; rare critical out-of-band patches bump the `+k0s.N` suffix independently). This
is a cleaner, more directly-stated mapping to upstream's own duration than either k3s's or RKE2's
"N/N-1/N-2 branch" framing. Source: [k0s docs — Releases & support model](https://docs.k0sproject.io/stable/releases/).

### ARM/edge support

The broadest architecture list of all five distros compared here: **x86_64, aarch64, armv7l
(32-bit ARM), and riscv64** (riscv64 has no pre-compiled binaries or CI coverage yet, i.e. it's
present in the roadmap but not yet a supported target). k0s also ships **dedicated, first-party
install guides for Raspberry Pi 4 and Raspberry Pi 5** specifically. Source:
[k0s docs — System Requirements](https://docs.k0sproject.io/stable/system-requirements/).

---

## Talos Linux

Upgrade *mechanics* (`talosctl upgrade`/`upgrade-k8s`, A/B image rollback, etcd-quorum-aware
control-plane upgrade sequencing, Omni) are already covered by
[#6's writeup](https://github.com/aaronkyriesenbach/catalyst/blob/research/cluster-lifecycle-research/docs/research/cluster-lifecycle-research.md)
and not repeated here. This section covers what that research didn't: footprint, bundled
defaults, the specifics of Talos's hardening posture, CNI flexibility, and ecosystem friction.

### Resource footprint

Minimum requirements: **control plane 2 GiB RAM / 2 cores; worker 1 GiB / 1 core** — in the same
ballpark as k3s, and notably lower than RKE2's floor. Recommended: control plane 4 GiB/4
cores/100 GiB disk, worker 2 GiB/2 cores/100 GiB disk. Source:
[Talos docs — System Requirements](https://docs.siderolabs.com/talos/v1.9/getting-started/system-requirements).
Talos Linux itself is under 100 MB, but a **minimum 10 GiB (100 GiB recommended) EPHEMERAL
partition** is still required for pulled images and container working directories — Talos's
minimalism is about the OS layer only; workload/image storage scales the same as on any distro.

### Default bundled components

Default CNI is **Talos-managed Flannel** (`cni.name: flannel`); the operator can instead set
`custom` (bring-your-own manifests via URLs) or `none` (Talos manages no CNI at all). Source:
[Talos v1alpha1 `Config` reference — `cni`](https://docs.siderolabs.com/talos/v1.13/reference/configuration/v1alpha1/config.md).
Talos ships **no default ingress controller, no default LoadBalancer implementation, and no
default storage/CSI** — its docs frame Talos purely as the thing that runs Kubernetes nodes,
leaving every cluster-addon decision to the operator. CoreDNS/kube-proxy are ordinary upstream
Kubernetes additions applied during cluster bootstrap, not Talos-specific bundling.
Notably, **control-plane nodes are tainted no-schedule by default** — "By default, Talos Linux
taints control plane nodes so that workloads are not schedulable on them" — requiring an explicit
`cluster.allowSchedulingOnControlPlanes: true` to run workloads there. This is a real, concrete
difference from k3s/RKE2/k0s, which schedule workloads onto a combined controller+worker node
without any special flag, and it directly affects catalyst's present 2-node
control-plane-only-plus-workloads topology. Source: [Talos docs — Enable workloads on your control plane nodes](https://docs.siderolabs.com/talos/v1.13/deploy-and-manage-workloads/workloads-on-controlplane.md).

### Security defaults/hardening posture

Talos's security story is the strongest and most automatic of the five, and is not a
configuration profile — it's baked into the OS. Kernel hardening follows the **Kernel
Self-Protection Project (KSPP)** recommendations at four layers: compile-time kernel config
(forced module-signature verification, `/dev/mem` disabled, legacy `kexec` disabled, AppArmor
hash verification kept on) that **cannot be changed by the operator at all**; boot-time parameters
(`slab_nomerge`, `pti=on`, `init_on_alloc=1`); and, from Talos v1.12 on, additional runtime sysctl
hardening — all applied on every node with zero configuration. Out of the box, with **no
CIS-profile flag required**, Talos already satisfies a long list of CIS Kubernetes Benchmark
controls: anonymous API-server auth disabled, no static token auth, audit logging enabled at
`Metadata` level, secrets encrypted at rest (`secretboxEncryptionSecret`, configured at cluster
creation), mutual TLS to etcd, kubelet certificate-based auth, profiling disabled on control-plane
components, the kubelet's default seccomp profile enabled, Pod Security Admission set to
`baseline` enforce / `restricted` audit+warn, and controller-manager/scheduler bound to loopback
only. On top of that, the OS-level design — **no SSH, no interactive shell, immutable root
filesystem, no package manager, API-only management** — means the majority of the CIS
Distribution-Independent Linux Benchmark simply doesn't apply to a Talos node (not "failed," out
of scope). Source: [Talos docs — Talos Default Hardening and CIS Compliance](https://docs.siderolabs.com/talos/v1.13/security/talos-default-hardening-and-cis-compliance.md),
[Talos docs — Getting Started](https://docs.siderolabs.com/talos/v1.9/getting-started/getting-started.md).
This is a meaningfully more automatic posture than RKE2's (which needs an explicit `profile: cis`
opt-in to reach a comparable baseline). SELinux support exists but is still labeled experimental,
same as the others.

### CNI defaults and flexibility

`flannel` / `custom` / `none`, chosen in the initial machine config. As with RKE2 and k0s,
changing the CNI after cluster creation is not a supported live operation — it's decided once, up
front. The `none` path is arguably the cleanest bring-your-own-CNI story of the five: because
Talos never partially wires up Flannel unless told to, there's no equivalent of k3s's documented
need to manually clean up leftover `cilium_host`/`cilium_net`/`cilium_vxlan` interfaces after
swapping away from an active Flannel install. Source:
[Talos v1alpha1 `Config` reference — `cni`](https://docs.siderolabs.com/talos/v1.13/reference/configuration/v1alpha1/config.md).

### Ecosystem/Helm-chart compatibility quirks

This is where Talos's immutability has the most direct, practical cost. There is no shell, no
`apt`/`yum`, and no arbitrary host binaries — any Helm chart or DaemonSet that assumes it can
`nsenter`/exec into the host, install packages at runtime, or rely on host tools like `iscsiadm`,
NFS client utilities, `multipath`, or ZFS kernel modules will not work unmodified. Talos's answer
is **System Extensions**: signed, versioned OS-image add-ons that must be baked into the
boot/installer image ahead of time, not installed at runtime. The official extension catalog
includes exactly the categories that matter for typical homelab storage CSI drivers:
`iscsi-tools`, `nfs-utils`/`nfsd`, `multipath-tools`, and `zfs`. Source:
[Talos docs — System Extensions](https://docs.siderolabs.com/talos/v1.13/build-and-extend-talos/custom-images-and-development/system-extensions.md),
[`siderolabs/extensions` repository contents](https://github.com/siderolabs/extensions).
This is a **direct, concrete friction point for catalyst specifically**: the map's current-state
snapshot lists `truenas-iscsi` as part of the existing storage layer, and no Helm chart or CSI
driver that expects `iscsiadm` to exist on the host will function on stock Talos — adopting Talos
for anything touching that storage path means building custom boot media with the `iscsi-tools`
extension first, a step none of the other four distros require (they run on a normal mutable
Linux host where `iscsiadm` is an ordinary package).

### Official support model, release cadence, upgrade/LTS policy

As already established by #6, Talos deliberately decouples OS-version upgrades from
Kubernetes-version upgrades. New data point from this research: **Talos 1.13 is validated against
six upstream Kubernetes minors simultaneously (1.31 through 1.36)** — a materially wider
single-OS-release Kubernetes compatibility window than k3s/RKE2/k0s, each of which ships one
distro-minor per matching Kubernetes minor. The tradeoff is that **Talos's own OS-release support
window is short**: Community support for a given Talos minor ends when the *next* Talos minor
ships (e.g. 1.12's community support ends at 1.13.0), roughly every 4–5 months, versus k3s/RKE2's
~14-month-per-branch or k0s's clean 14-month upstream mirror. Staying supported on Talos means
tracking Talos OS releases more often, even though the Kubernetes version underneath doesn't have
to move in lockstep. Sidero Labs offers paid Enterprise support for longer windows. Source:
[Talos docs — Support Matrix](https://docs.siderolabs.com/talos/v1.13/getting-started/support-matrix.md).

### ARM/edge support

**amd64 and arm64 only** (no 32-bit ARM, no RISC-V) — narrower architecture coverage than k3s or
k0s — but with dedicated, tested install guides for a long list of specific single-board
computers (Raspberry Pi 4B/CM4, Pine64/Rock64, Radxa ROCK 4C+/5B/Pi 4, Turing RK1, Orange Pi 5,
Jetson Nano, and more). Source: [Talos docs — Support Matrix](https://docs.siderolabs.com/talos/v1.13/getting-started/support-matrix.md),
[Talos docs — Single Board Computers](https://docs.siderolabs.com/talos/v1.13/platform-specific-installations/single-board-computers/rpi_generic.md).

---

## Vanilla kubeadm (on Ubuntu Server/Debian)

Upgrade *mechanics* for kubeadm clusters (one-minor-at-a-time upgrades, `kubeadm upgrade`) are
already covered by [#6's writeup](https://github.com/aaronkyriesenbach/catalyst/blob/research/cluster-lifecycle-research/docs/research/cluster-lifecycle-research.md)
and not repeated here.

### Resource footprint

Minimum: **2 GB RAM per machine, 2+ CPUs for control-plane machines.** Source:
[Kubernetes docs — Installing kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/).
This headline number matches k3s's server minimum, but the underlying reality differs: kubeadm
runs each control-plane component as its own static pod/binary with no k3s-style single-process
consolidation, so the aggregate idle footprint for equivalent functionality is generally *higher*
than k3s's — this is precisely the gap k3s's own README calls out as its reason for existing.

### Default bundled components

`kubeadm init` deploys **CoreDNS and kube-proxy automatically** as part of bootstrap — contrary to
a strict "nothing" reading, these two are on by default. Beyond that, kubeadm bundles **no CNI**
(CoreDNS pods remain `Pending` until one is installed), **no ingress controller, no LoadBalancer
implementation, no storage class/CSI, and no metrics-server**. kubeadm's own docs state it is
explicitly **"CNI agnostic"** and treats CNI-plugin issues as out of scope for its own testing and
issue tracker. Source: [Kubernetes docs — Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/).

### Security defaults/hardening posture

Whatever vanilla upstream Kubernetes defaults are, with zero distro-level opinion layered on top.
Concretely: the API server stores secrets in etcd as **plaintext by default** — encryption at
rest is an explicit, manual `EncryptionConfiguration` task. Source:
[Kubernetes docs — Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/).
There is no bundled CIS-profile flag, no automatic audit-log configuration, and no SELinux/AppArmor
wiring — this is the zero-hardening baseline that k3s's, RKE2's, and Talos's own CIS-hardening
docs are implicitly measured against. It runs on a completely standard, mutable Linux host: full
SSH access, standard package manager, systemd units for kubelet/containerd — the most traditional
posture of the five, and the one most familiar to existing sysadmin tooling.

### CNI defaults and flexibility

Fully agnostic by design and by explicit statement: the operator installs any CNI plugin of choice
after `kubeadm init`, with no bundled default, no embedded LoadBalancer, and nothing distro-specific
to disable first. Source: [Kubernetes docs — Creating a cluster with kubeadm, "Installing a Pod
network add-on"](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/).

### Ecosystem/Helm-chart compatibility quirks

Because this *is* upstream Kubernetes on a general-purpose Linux distribution with completely
standard paths (`/var/lib/kubelet`, `/etc/kubernetes`, the standard containerd/CRI-O socket, and
the conventional `~/.kube/config` convention once copied from `/etc/kubernetes/admin.conf`), it is
the environment the overwhelming majority of community Helm charts and operators are authored and
tested against first. None of the friction the other four distros create for chart authors
(non-standard kubeconfig paths, non-standard container-runtime sockets, no kubelet service file,
immutable root filesystem, no shell) exists here. This is kubeadm's central ecosystem advantage:
it is the least likely of the five to need any distro-specific workaround for a random community
chart — at the cost of getting none of the other four's operational conveniences for free either.

### Official support model, release cadence, upgrade/LTS policy

kubeadm *is* upstream Kubernetes tooling, released in lockstep with Kubernetes itself — there is no
separate distro cadence to track. Kubernetes' own patch-release policy applies directly: each minor
is patched roughly monthly for **~14 months total** (12 "standard" + 2 "maintenance mode"). Source:
[Kubernetes — Patch Releases](https://kubernetes.io/releases/patch-releases/).
Version-skew rules: kubeadm must be within one minor version of the Kubernetes version it manages;
kubelet may be up to **three minor versions older** than kubeadm/the control plane; upgrades must
be performed one minor version at a time. Source: [Kubernetes docs — Creating a cluster with
kubeadm, "Version skew policy"](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/).

### ARM/edge support

The broadest official architecture support of all five distros compared, by a wide margin:
kubeadm packages/binaries are built for **amd64, arm (32-bit), arm64, ppc64le, and s390x**,
following Kubernetes' own multi-platform build proposal — including two server architectures
(`ppc64le`, `s390x`) none of the other four distros target at all. The caveat every distro shares
equally: actual CNI-plugin support per architecture varies by network provider, not by distro.
Source: [Kubernetes docs — Creating a cluster with kubeadm, "Platform compatibility"](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/).

---

## Comparison summary

| | k3s | RKE2 | k0s | Talos Linux | kubeadm |
|---|---|---|---|---|---|
| Min control-plane RAM / CPU | 2 GB / 2 cores | 4 GB / 2 cores | 1 GB / 1 vCPU | 2 GiB / 2 cores | 2 GB / 2 CPUs |
| Min worker RAM / CPU | 512 MB / 1 core | (sizing table only) | 0.5 GB / 1 vCPU | 1 GiB / 1 core | not separately documented |
| Kubelet/CRI on control-plane nodes | Yes | Yes | **No** (naked process, no CRI by default) | Yes (tainted no-schedule by default) | Yes |
| Default CNI | Flannel | Canal (Flannel+Calico) | Kube-router | Flannel | **None** (fully agnostic) |
| Bundled CNI alternatives | none (BYO) | Cilium, Calico, Flannel | Calico | none (`custom`/`none`) | none (BYO) |
| CNI changeable post-install | Discouraged, some manual cleanup (e.g. Cilium) | **No** — rebuild required | **No** — rebuild required | **No** — rebuild required | N/A, chosen fresh each time |
| Default ingress | Traefik | ingress-nginx → **Traefik as of v1.36** (mid-transition) | none (opt-in extension) | none | none |
| Default LoadBalancer | ServiceLB (Klipper) | none | none (MetalLB opt-in) | none | none |
| Default storage/CSI | local-path-provisioner | none | none (opt-in extensions) | none | none |
| Default datastore | SQLite (single-server) / embedded etcd (HA) | embedded etcd (SQLite experimental) | embedded etcd (kine: MySQL/Postgres/SQLite/dqlite also supported) | etcd | etcd |
| Security hardening by default | Minimal — fully manual CIS guide | **Strong** — `profile: cis` automates most of it | Moderate — passes most kube-bench checks; audit/encryption still manual | **Strongest** — KSPP kernel hardening + much of CIS satisfied unconditionally | None — raw upstream defaults |
| FIPS 140-2/3 | not offered | Yes (140-2) | not documented | Yes (140-3 builds) | not offered |
| Non-standard kubeconfig path | `/etc/rancher/k3s/k3s.yaml` | `/etc/rancher/rke2/rke2.yaml` | none by default | via `talosctl kubeconfig` | standard `/etc/kubernetes/admin.conf` |
| SSH / shell access | Yes (normal Linux host) | Yes (normal Linux host) | Yes (normal Linux host) | **No** — API-only, no SSH/shell | Yes (normal Linux host) |
| Release/support model | Backports last 3 branches; ~30-day minor lag | Same branch model as k3s | Directly mirrors upstream's 14-month window per minor | OS decoupled from K8s; ~6 K8s minors per Talos minor; short (~4–5 month) OS-release window | Is upstream K8s directly; 14-month window |
| Architectures | x86_64, armhf, arm64 | x86_64, arm64 | x86_64, arm64, armv7l, riscv64 (experimental) | amd64, arm64 | amd64, arm (32-bit), arm64, ppc64le, s390x |

---

## Recommendation

This is purely a distribution-level opinion, feeding into — not deciding — ticket
[#7](https://github.com/aaronkyriesenbach/catalyst/issues/7), which also has to weigh
[#6's lifecycle-tooling findings](https://github.com/aaronkyriesenbach/catalyst/blob/research/cluster-lifecycle-research/docs/research/cluster-lifecycle-research.md)
(which already leaned toward Talos + optional self-hosted Omni for new clusters, on lifecycle
grounds).

**Talos Linux comes out ahead on distribution-level merits**, for reasons independent of that
prior lifecycle-tooling conclusion:

1. **It is the most neutral substrate for the two decisions that are still genuinely open.**
   Talos ships no default ingress, no default LoadBalancer, and no default storage, and its CNI
   defaults to Flannel only until told otherwise via a clean `none`/`custom` path with no partial
   wiring to unwind. That means adopting Talos doesn't quietly pre-answer
   [#36 (ingress)](https://github.com/aaronkyriesenbach/catalyst/issues/36) or the CNI half of
   [#21 (mesh implementation)](https://github.com/aaronkyriesenbach/catalyst/issues/21) the way
   k3s (Traefik + Flannel, already in place) or RKE2 (mid-transition between two different default
   ingresses) do.
2. **Its security defaults are the strongest of the five, and they're unconditional rather than
   an opt-in profile** — directly complementary to this map's already-made decision to adopt
   NetworkPolicies now ([#32](https://github.com/aaronkyriesenbach/catalyst/issues/32)), and low
   operational drag for a single operator: there's no CIS checklist to hand-execute the way there
   is for k3s, and no separate `profile: cis` flag to remember to set the way there is for RKE2.
3. **Decoupled OS/Kubernetes upgrades scale well with hardware that is explicitly expected to
   grow and change** (per the map's Notes) — a single Talos OS minor already tracks six
   Kubernetes minors, so hardware refreshes and Kubernetes version bumps don't have to happen on
   the same schedule.
4. **Its resource floor is competitive with k3s's and well under RKE2's**, which matters directly
   on today's modest Proxmox VMs.

This recommendation comes with two real, distro-level costs to weigh at #7, not hand-waved away:

- **The existing `truenas-iscsi` storage dependency is a genuine adoption cost.** Stock Talos has
  no `iscsiadm` and no path to get one at runtime — using that storage path on Talos requires
  building custom boot media with the `iscsi-tools` system extension before the cluster is usable
  as-is. This is a real, concrete migration step none of the other four distros require.
- **No-SSH/API-only is a real paradigm change for a single operator**, not just a security
  win — it cuts both ways against this map's own stated interest in hands-on learning (the same
  rationale [#33](https://github.com/aaronkyriesenbach/catalyst/issues/33) used to justify
  adopting a service mesh at all): it's a different, valuable thing to learn, but it does remove
  the familiar SSH-and-poke-around debugging loop.

**k3s remains a credible runner-up purely because it's already running** — zero migration cost,
and the lightest-weight of the four "batteries-included" distros if Talos's operational model is
judged not worth switching for. If it's kept, its bundled Traefik/ServiceLB/local-path-provisioner
should be explicitly disabled from day one, precisely so the still-open ingress and storage
decisions are made deliberately rather than defaulted into by the distro's own bundling choices.

**RKE2 and vanilla kubeadm are not recommended as the primary choice.** RKE2's resource floor and
compliance-grade hardening (FIPS, SELinux, government-benchmark defaults) solve a problem this
single-operator homelab doesn't have, and it is presently mid-transition on its own default
ingress — an unstable moment to adopt it for a decision this map is trying to make deliberately.
Vanilla kubeadm carries all of the DIY cost (every hardening decision, every CNI choice, every
addon) with none of the batteries-included convenience, which is a poor trade for a single
operator's limited time on a decision that isn't really about kubeadm itself — though kubeadm
remains the right underlying substrate if/when #6's CAPI or Kubespray/Ansible paths are actually
adopted, since that's exactly what those tools already build on.

**k0s is a dark horse worth remembering, not adopting today.** Its architecture breadth
(`armv7l`, experimental `riscv64`, dedicated Raspberry Pi guides) and rock-bottom measured
control-plane memory make it the best-positioned of the five if future hardware genuinely includes
small non-x86 nodes — but that's not today's estate, and its ecosystem/mindshare is the smallest of
the group, which raises the odds of hitting an undocumented rough edge first. Worth a second look
specifically if/when ARM or edge hardware enters the picture.

**The final call belongs to ticket #7**, which should read this alongside #6's lifecycle-tooling
conclusions rather than treat either document as sufficient alone — the two tickets are evaluating
overlapping but not identical criteria (this one is distro-vs-distro on the merits; #6 is
lifecycle-tooling-vs-lifecycle-tooling, with distros only as substrates).

---

## Sources

- K3s docs — Requirements: https://docs.k3s.io/installation/requirements
- K3s docs — Networking Services: https://docs.k3s.io/networking/networking-services
- K3s docs — Basic Network Options: https://docs.k3s.io/networking/basic-network-options
- K3s docs — Cluster Datastore: https://docs.k3s.io/datastore
- K3s docs — Managing Packaged Components: https://docs.k3s.io/installation/packaged-components
- K3s docs — Cluster Access: https://docs.k3s.io/cluster-access
- K3s docs — Private Registry Configuration: https://docs.k3s.io/installation/private-registry
- K3s docs — CIS Hardening Guide: https://docs.k3s.io/security/hardening-guide
- K3s docs — Known Issues: https://docs.k3s.io/known-issues
- K3s docs — Manual Upgrades: https://docs.k3s.io/upgrades/manual
- `k3s-io/k3s` README: https://raw.githubusercontent.com/k3s-io/k3s/master/README.md
- `k3s-io/k3s` ROADMAP.md: https://raw.githubusercontent.com/k3s-io/k3s/master/ROADMAP.md
- RKE2 docs — Requirements: https://docs.rke2.io/install/requirements
- RKE2 docs — Network Options: https://docs.rke2.io/networking/basic_network_options
- RKE2 docs — Managing Packaged Components: https://docs.rke2.io/install/packaged_components
- RKE2 docs — CIS Hardening Guide: https://docs.rke2.io/security/hardening_guide
- RKE2 docs — SELinux: https://docs.rke2.io/security/selinux
- RKE2 docs — Embedded datastore: https://docs.rke2.io/datastore/embedded
- RKE2 docs — Known Issues: https://docs.rke2.io/known_issues
- RKE2 v1.36.X Release Notes: https://docs.rke2.io/release-notes/v1.36.X
- RKE2 docs — Ingress NGINX to Traefik Migration Guide: https://docs.rke2.io/reference/ingress_migration
- `rancher/rke2` README: https://raw.githubusercontent.com/rancher/rke2/master/README.md
- `rancher/rke2` charts/chart_versions.yaml: https://raw.githubusercontent.com/rancher/rke2/master/charts/chart_versions.yaml
- k0s docs — System Requirements: https://docs.k0sproject.io/stable/system-requirements/
- k0s docs — Architecture: https://docs.k0sproject.io/stable/architecture/
- k0s docs — Networking (CNI): https://docs.k0sproject.io/v1.36.3+k0s.2/networking/
- k0s docs — Storage (CSI): https://docs.k0sproject.io/stable/storage/
- k0s docs — SELinux: https://docs.k0sproject.io/v1.36.3+k0s.2/selinux/
- k0s docs — Kube-bench Security Benchmark: https://docs.k0sproject.io/v1.36.3+k0s.2/cis_benchmark/
- k0s docs — Releases & support model: https://docs.k0sproject.io/stable/releases/
- Talos docs — System Requirements: https://docs.siderolabs.com/talos/v1.9/getting-started/system-requirements
- Talos docs — Getting Started: https://docs.siderolabs.com/talos/v1.9/getting-started/getting-started.md
- Talos docs — Enable workloads on your control plane nodes: https://docs.siderolabs.com/talos/v1.13/deploy-and-manage-workloads/workloads-on-controlplane.md
- Talos docs — Talos Default Hardening and CIS Compliance: https://docs.siderolabs.com/talos/v1.13/security/talos-default-hardening-and-cis-compliance.md
- Talos v1alpha1 `Config` reference: https://docs.siderolabs.com/talos/v1.13/reference/configuration/v1alpha1/config.md
- Talos docs — System Extensions: https://docs.siderolabs.com/talos/v1.13/build-and-extend-talos/custom-images-and-development/system-extensions.md
- `siderolabs/extensions` repository: https://github.com/siderolabs/extensions
- Talos docs — Support Matrix: https://docs.siderolabs.com/talos/v1.13/getting-started/support-matrix.md
- Talos docs — Single Board Computers: https://docs.siderolabs.com/talos/v1.13/platform-specific-installations/single-board-computers/rpi_generic.md
- Kubernetes docs — Installing kubeadm: https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/
- Kubernetes docs — Creating a cluster with kubeadm: https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/
- Kubernetes docs — Encrypting Confidential Data at Rest: https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/
- Kubernetes — Patch Releases: https://kubernetes.io/releases/patch-releases/
- catalyst repo (current-state context): `cluster/README.md`, map issue [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1) Notes/Decisions-so-far
- [#6 — cluster-lifecycle-research.md](https://github.com/aaronkyriesenbach/catalyst/blob/research/cluster-lifecycle-research/docs/research/cluster-lifecycle-research.md)
- [#20 — mesh-impl-research.md](https://github.com/aaronkyriesenbach/catalyst/blob/research/mesh-impl-research/docs/research/mesh-impl-research.md)
