# Research: Talos-compatible cluster-lifecycle/management-plane options

**Ticket**: [#51](https://github.com/aaronkyriesenbach/catalyst/issues/51) — feeds
[#52, "Re-decide the cluster-lifecycle/management-plane tooling (Omni vs. CAPI vs.
alternatives) on its own merits"](https://github.com/aaronkyriesenbach/catalyst/issues/52) —
part of the ["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: Talos Linux itself is locked in ([#7](https://github.com/aaronkyriesenbach/catalyst/issues/7),
not reopened here). The prior lifecycle research
([#6](https://github.com/aaronkyriesenbach/catalyst/issues/6), `docs/research/cluster-lifecycle-research.md`
on branch `research/cluster-lifecycle-research`) surveyed Cluster API generically — via CAPMOX, its
Proxmox infra provider, using plain kubeadm — and Talos+Omni as a bundled package, but never evaluated
Cluster API's own Talos bootstrap/control-plane providers running Talos nodes under CAPI *instead of*
Omni, as a like-for-like alternative specifically as a Talos-cluster manager. This document re-compares
that narrower field, re-verifying rather than assuming the Omni-specific facts already reasoned through
in [ADR 0011](../adr/0011-cluster-registration-cross-cluster-auth.md) and
[ADR 0012](../adr/0012-omni-deployment-model-availability.md).

---

## TL;DR

- **The headline finding: Sidero Labs itself has stopped developing the CAPI-on-Talos path.** As of
  2026-08-13/14, `cluster-api-bootstrap-provider-talos` (CABPT), `cluster-api-control-plane-provider-talos`
  (CACPPT), *and* `sidero` (the bare-metal CAPI infrastructure provider, "Sidero Metal") all carry an
  identical, freshly-added `[!CAUTION]` notice in their own READMEs: *"Sidero Labs is no longer actively
  developing [this project]. For an alternative, please see [Omni]... Unless you have an existing
  support contract... all support will be provided by the community."* This is not a rumor or a stale
  doc — it is the current state of the repos' own default branches, added in three near-simultaneous
  commits. **CABPT+CACPPT (the entire officially-maintained CAPI-on-Talos stack) is now community-supported
  only, by its own maintainer's admission**, which reframes every other finding below.
- **CAPMOX (the Proxmox infra provider) does not get you kube-vip "for free" when paired with
  CABPT/CACPPT the way it does with plain kubeadm.** CAPMOX's own `KubeadmControlPlane`-based quickstart
  template bakes a kube-vip static-pod manifest into `KubeadmConfigSpec.files` — a mechanism specific to
  the kubeadm bootstrap provider. CABPT's `TalosConfigTemplate`/`TalosControlPlane` API has no equivalent
  field (only `generateType`, `configPatches`/`strategicPatches`, `data`, `hostname`) — confirmed by
  reading the CABPT README directly and by a zero-result GitHub code search for `kube-vip` across both
  `siderolabs/cluster-api-bootstrap-provider-talos` and `siderolabs/cluster-api-control-plane-provider-talos`.
  Getting a VIP with CAPMOX+CABPT/CACPPT is *possible* — Talos supports both a native, control-plane-only
  VIP feature (`Layer2VIPConfig`) and arbitrary static pods (`machine.pods`), either of which could be
  injected as a hand-authored `configPatches`/`strategicPatches` entry — but it is DIY glue, not a
  built-in template, unlike CAPMOX's own kubeadm flavor. No official CAPMOX template ships a Talos
  flavor at all (checked the `templates/` directory directly: Calico, Cilium, dual-stack, Flatcar,
  multiple-VLANs, proxmox-labels — no Talos entry).
- **Sidero Omni's previously-surfaced facts all re-verify as still accurate today**, against the current
  live docs: SideroLink (WireGuard overlay, mandatory for every Omni-managed machine), unified OS+K8s
  upgrade orchestration (now documented in even more detail than before — per-machine-set rolling
  strategies, node locking, etcd-backup-gated upgrades, healthcheck gating), Image Factory/`systemExtensions`
  declared directly in Cluster Templates, and the forbidden-native-VIP constraint
  (`cluster.controlPlane.endpoint` and `cluster.vip` are both still listed as forbidden/overridden fields).
  Its blast radius is exactly what ADR 0011/0012 already reasoned through and accepted: Omni is not part
  of the Kubernetes control plane, so its unavailability pauses external access (`kubectl`, GitOps
  reconciliation) but not already-running workloads.
- **k0smotron's Remote Machine Provider cannot pair with Talos at all, mechanically, not just by
  convention.** Its own docs describe a `RemoteMachine` as "a machine... which can be remotely connected
  via SSH," configured with `port: 22`, `sshKeyRef`, `useSudo`, and executes literal shell commands
  (`systemctl stop ...`, `/usr/local/bin/k0s etcd leave`) for provisioning and cleanup. Talos Linux's own
  philosophy docs state flatly: *"We have no shell. We have no SSH."* There is no code path by which
  k0smotron's SSH-executor infrastructure provider could reach a Talos node — this isn't a documentation
  gap, it's a protocol mismatch baked into Talos's design. k0smotron is excluded on this basis, not
  because it lacks a Proxmox-specific integration.
- **No other Talos-native or Talos-compatible management plane was found that isn't already covered
  by, or a strict subset of, the above.** `siderolabs/terraform-provider-talos` (still actively
  maintained, no deprecation notice) offers a genuinely different "no management plane at all" shape —
  apply Talos machine config and bootstrap directly from Terraform/OpenTofu, paired with an existing VM
  provisioner (e.g. this repo's own `bpg/proxmox`) — but it does no upgrade orchestration of its own; you
  script `talosctl upgrade`/`upgrade-k8s` yourself, same as the "kubeadm/Ansible" bucket in the prior
  research (#6).

---

## 1. Cluster API + CABPT (+ CACPPT, + CAPMOX)

### Maturity and activity — now openly deprecated by the maintainer

`cluster-api-bootstrap-provider-talos` (CABPT) and `cluster-api-control-plane-provider-talos` (CACPPT)
are both Sidero Labs/`siderolabs`-org repos, MPL-2.0 licensed, 240 and 167 GitHub stars respectively
(checked via the GitHub API). Both repos' `main`-branch READMEs currently open with the identical
caution block:

> *"Sidero Labs is no longer actively developing Cluster API Bootstrap Provider Talos [/ Cluster API
> Control Plane Provider Talos]. For an alternative, please see [Omni](https://github.com/siderolabs/omni.git).
> Unless you have an existing support contract covering [this project], all support will be provided by
> the community (including questions in our Slack workspace)."*

Source: [`siderolabs/cluster-api-bootstrap-provider-talos` README](https://github.com/siderolabs/cluster-api-bootstrap-provider-talos/blob/main/README.md),
[`siderolabs/cluster-api-control-plane-provider-talos` README](https://github.com/siderolabs/cluster-api-control-plane-provider-talos/blob/main/README.md).
This notice was added in commit
[`855be5e`](https://github.com/siderolabs/cluster-api-bootstrap-provider-talos/commit/855be5eb428593eaa18a15530f07121c4a97c1e8)
(CABPT, 2026-08-13, "docs: add deprecation notice to the README... The note mirrors the one in the
Sidero Metal repo") and commit `9e552e4` (CACPPT, 2026-08-14) — both authored by a Sidero Labs engineer,
both explicit that the note is a deliberate, repo-wide policy statement, not an isolated aside.
The third leg of the pre-Omni CAPI-on-Talos stack, **Sidero Metal** (`siderolabs/sidero`, the bare-metal
CAPI infrastructure provider), carries the *exact same* wording, pointing to "the Bare-Metal
Infrastructure Provider" (an Omni component) as its replacement — source:
[`siderolabs/sidero` README](https://github.com/siderolabs/sidero/blob/main/README.md). All three
notices reference each other ("mirrors the one in the Sidero Metal repo"), confirming a single,
coordinated decision by the maintaining org, not three independent choices.

This is not (yet) reflected in upstream Cluster API's own documentation: the CAPI Book's provider
registry still lists "Talos" under both Bootstrap and Control Plane provider categories — source:
[Cluster API Book — Provider List](https://cluster-api.sigs.k8s.io/reference/providers). CAPI itself
(`kubernetes-sigs/cluster-api`) remains extremely active (4,279 stars, latest release `v1.14.0` on
2026-08-11, pushed same day as this research) — the deprecation is specific to Sidero Labs' own
Talos-bootstrap/control-plane/bare-metal providers, not to CAPI as a project.

CABPT has continued to receive compatibility updates even after the caution notice — commit
`fcd4753c` ("fix: bypass immutability check for topology dry-run", 2026-06-14, before the notice) and the
notice-adding commit itself (2026-08-13) are both within the last ~5 weeks of this research, and CABPT's
last tagged release (`v0.7.0-alpha.2`) added Talos 1.13 and CAPI v1beta2 support in April 2026 — so
"no longer actively developing" describes future intent, not an already-stale codebase; both providers
are current with the newest Talos/CAPI versions as of this research. However, real, user-facing bugs
remain open and unresolved for extended periods: CACPPT issue
[#225](https://github.com/siderolabs/cluster-api-control-plane-provider-talos/issues/225), "Control
plane rolling updates is not working," filed 2025-08-28, is still open a year later; issue
[#262](https://github.com/siderolabs/cluster-api-control-plane-provider-talos/issues/262), a control-plane
etcd deadlock, was filed 2026-07-13 and remains open. Release cadence for CABPT (via the GitHub Releases
API) has been roughly 2-6 per year since 2022 (`v0.6.4` through `v0.6.12`, plus the `v0.7.0-alpha.x`
series), consistent with a small, part-time-maintained project even before the August 2026 notice.

### Pairing with CAPMOX for a full CAPI-on-Talos stack on Proxmox

CAPMOX (`ionos-cloud/cluster-api-provider-proxmox`) is IONOS Cloud's Proxmox VE infrastructure provider
for CAPI — this repo's existing research (#6) already covers its general maturity (actively developed,
Apache-2.0, current release `v0.9.0` as of 2026-06-30). Its own quickstart is built entirely around
**kubeadm**, not Talos: the dependencies list a Proxmox VE template built with `image-builder`'s Proxmox
provider, `clusterctl generate cluster --infrastructure proxmox`, and `EXP_KUBEADM_BOOTSTRAP_FORMAT_IGNITION`
as a required env var — source: [`cluster-api-provider-proxmox` Usage guide](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/main/docs/Usage.md).
Its default `cluster-template.yaml` wires a `KubeadmControlPlane` with `kubeadmConfigSpec.files` dropping
a literal kube-vip static-pod manifest to `/etc/kubernetes/manifests/kube-vip.yaml`, keyed off
`CONTROL_PLANE_ENDPOINT_IP` — source:
[`cluster-api-provider-proxmox/templates/cluster-template.yaml`](https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/main/templates/cluster-template.yaml).
This `files`/`preKubeadmCommands` mechanism belongs to the **kubeadm bootstrap provider's own API**
(`KubeadmConfigSpec`), not to CAPMOX itself — it is not available on CABPT's `TalosConfigTemplate`,
which only exposes `generateType`, `configPatches`, `strategicPatches`, `data`, and `hostname` — source:
[CABPT README, "Usage"](https://github.com/siderolabs/cluster-api-bootstrap-provider-talos/blob/main/README.md).
A repo-wide GitHub code search for `kube-vip` across both `cluster-api-bootstrap-provider-talos` and
`cluster-api-control-plane-provider-talos` returns **zero results**, confirming neither Talos-specific
CAPI provider ships any built-in kube-vip integration. CAPMOX's own `templates/` directory (checked
directly — `cluster-class.yaml`, `cluster-class-calico.yaml`, `cluster-class-cilium.yaml`,
`cluster-template*-{auto-image,calico,cilium,cilium-load-balancer,dual-stack,external-creds,flatcar,
multiple-vlans,proxmox-labels}.yaml`) contains no Talos flavor at all — only a Flatcar (a different
container-optimized distro) alternative to the default kubeadm/Ubuntu-style flavor. Sidero Labs itself
has never published an integration guide combining CAPMOX specifically with CABPT/CACPPT; the handful
of community repos that attempt this pairing (e.g. `Randsw/proxmox-capi-talos`, `axinorm/proxmox-capi-talos`,
found via GitHub search) are small, individually-maintained projects, not an officially blessed path —
cited here only to establish that the combination is a known DIY pattern, not as evidence of its
correctness or completeness.

### Does CAPMOX + CABPT/CACPPT get you a native control-plane VIP?

**Not out of the box — but it is achievable, and arguably more "native" than kube-vip once achieved.**
CAPMOX's `ProxmoxCluster.spec.controlPlaneEndpoint.host` still needs an IP regardless of which control-plane
provider is used, but nothing serves that IP unless something is explicitly configured to. Talos ships
its own first-party virtual-IP feature for exactly this role, `Layer2VIPConfig`
(`machine.network.interfaces[].vip`), whose own config-reference description states: *"Virtual IP
configuration should be used only on controlplane nodes to provide virtual IP for Kubernetes API server.
Any other use cases are not supported"* — source:
[Talos config reference — `Layer2VIPConfig`](https://docs.siderolabs.com/talos/v1.13/reference/configuration/network/layer2vipconfig.md).
Talos also supports arbitrary static pods via `machine.pods` (bypassing the kubelet's normal API-server
admission path), which is the mechanism a hand-authored kube-vip static pod would use instead — source:
[Talos docs — Static Pods](https://docs.siderolabs.com/talos/v1.13/configure-your-talos-cluster/images-container-runtime/static-pods.md).
Either mechanism is expressible as a `configPatches`/`strategicPatches` entry on the `TalosControlPlane`'s
`controlPlaneConfig.controlplane` block — a field CABPT/CACPPT do support — source:
[CACPPT README, "Creating Your Own Templates"](https://github.com/siderolabs/cluster-api-control-plane-provider-talos/blob/main/README.md).
Talos's own troubleshooting docs list both options (Talos-native VIP, and "BGP peering of a shared IP
(such as with kube-vip)") as generic, non-Omni-specific control-plane-endpoint strategies — source:
[Talos docs — Troubleshooting: control plane endpoint options](https://docs.siderolabs.com/talos/v1.13/troubleshooting/troubleshooting.md).
**Net: yes, a CAPMOX+CABPT/CACPPT cluster can get a directly-reachable control-plane VIP, independent of
any management-plane availability — this is the concrete capability Omni's proxy model gives up — but
achieving it requires authoring the machine-config patch by hand; no CAPMOX/CABPT/CACPPT template does
it automatically today**, unlike CAPMOX's own kubeadm flavor.

---

## 2. Sidero Omni — re-verified

Every previously-surfaced fact was checked directly against Omni's current live docs (not cached or
assumed) for this research.

**SideroLink.** Still exactly as previously described: *"SideroLink offers a secure point-to-point
management overlay network for Talos clusters using Wireguard. Each Talos machine configured with
SideroLink establishes a secure Wireguard connection to the SideroLink API server... SideroLink is a
fundamental component of Sidero Omni."* Connection flow: ephemeral WireGuard keypair generated on the
machine, gRPC handshake to the SideroLink API server with a join token, server responds with its own
WireGuard public key and two ULA IPv6 addresses (one per side), interface configured, auto-reconnect on
drop. Source: [Talos docs — SideroLink](https://docs.siderolabs.com/talos/v1.13/networking/siderolink.md).
Worth noting: SideroLink is a Talos-Linux-level protocol (configurable via a kernel arg or a
`SideroLinkConfig` machine-config document even outside Omni), but it exists specifically *for* Omni —
there's no independent, non-Omni management server that speaks it in practice.

**Cluster Templates.** Confirmed current and unchanged in shape: a multi-document YAML (`Cluster`,
`ControlPlane`, `Workers`, `Machine`/`MachineClass`) that Omni continuously reconciles, applied and
updated via `omnictl cluster template sync`, supporting either explicit machine UUIDs or machine classes
(the latter also driving auto-provisioning through Infrastructure Providers, e.g.
`omni-infra-provider-proxmox`). Source: [Omni docs — Introduction to Cluster Templates](https://docs.siderolabs.com/omni/omni-cluster-setup/cluster-template.md).
Node scaling: increase/decrease a machine class's `size:` field (auto-provisioned case) or add/remove
explicit UUIDs, then re-sync; the UI offers the same operations without hand-editing YAML. Source:
[Omni docs — Scale a Cluster Up or Down](https://docs.siderolabs.com/omni/cluster-management/scale-your-cluster/scale-a-cluster-up-or-down.md).
Control-plane node count must stay odd (1/3/5) for etcd quorum — enforced by documentation, not the API,
same constraint every etcd-backed system has.

**Image Factory / `systemExtensions`.** Confirmed current: `systemExtensions` (and `kernelArgs`,
`patches`) can be declared directly on the `Cluster`, `ControlPlane`, `Workers`, or `MachineClass`
documents in a Cluster Template — e.g. `systemExtensions: [siderolabs/hello-world-service]` — and Omni
applies them cluster/machine-set-wide. Source: [Omni docs — Cluster Templates reference](https://docs.siderolabs.com/omni/reference/cluster-templates.md).
The underlying Image Factory service (`factory.talos.dev`) itself is a general, free, Omni-independent
Talos-ecosystem service that turns a YAML "schematic" (`customization.systemExtensions.officialExtensions`,
`extraKernelArgs`, `meta`) into a concrete image (ISO, disk image, installer container, etc.) —
source: [Talos docs — Image Factory](https://docs.siderolabs.com/talos/v1.13/learn-more/image-factory.md).
Omni's value-add is integrating this directly into the declarative Cluster Template rather than requiring
manual schematic-ID lookups, not providing something otherwise unavailable to bare CAPI+Talos.

**The no-native-VIP constraint.** Still confirmed, verbatim, in Omni's current config-overrides
reference: `cluster.controlPlane.endpoint` is listed as forbidden ("Omni provides the cluster endpoint
(VIP / external endpoint). User-defined endpoints are not allowed") and `cluster.vip` is listed
separately as forbidden ("The concept of a cluster VIP does not apply since Omni exposes a managed
external endpoint"). Source: [Omni docs — Talos Config Overrides](https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md)
(this reference page has grown since the prior research pass — it now also documents forbidden/ignored
fields for cluster naming, secrets, CAs, discovery config, disk-encryption secrets, install extensions/
kernel args, and accepted CAs, all for the same reason: Omni is the single source of truth for cluster
identity/security/connectivity).

**Blast radius, re-confirmed against this repo's already-accepted tradeoffs (ADR 0011/0012).** Omni's
own "Options for Running Omni" doc states the exact reasoning ADR 0012 already relied on, now even more
explicitly: *"Omni is not part of the Kubernetes control plane, and temporary unavailability does not
affect how your clusters run. They continue operating normally, and Talos machines reconnect when it
becomes available again... Omni **is** the authentication mechanism for external access to Talos and
Kubernetes. All external user (e.g., `kubectl`) and service (e.g., Infrastructure Providers) communication
goes through Omni. If Omni is unavailable for extended periods of time, external communication will not
work until Omni is recovered."* Source: [Omni docs — Options for Running Omni](https://docs.siderolabs.com/omni/self-hosted/options-for-running-omni.md).
This is exactly ADR 0011's finding (ArgoCD's GitOps reconciliation is external-access traffic, and is
therefore Omni-proxy-dependent) and exactly ADR 0012's accepted risk (single-VM Omni, ~99.9% achievable
uptime, "recommended default for on-prem" per Sidero's own comparison table) — both ADRs' reasoning holds
up against the current docs without correction.

**Upgrade orchestration — richer than previously documented.** Omni now documents unified OS+Kubernetes
upgrade mechanics in significantly more depth than the prior research found: per-machine-set
`updateStrategy` (config/label changes) and `upgradeStrategy` (Talos version/extension/kernel-arg
changes) each independently control rollout concurrency (`maxParallelism`); control-plane machine sets
always roll one-at-a-time with etcd-health verification between nodes (non-configurable); nodes can be
individually **locked** to hold back a rollout for staged validation; Kubernetes upgrades pre-pull images,
update static pods, `kube-proxy`, then kubelet in sequence, and deliberately do **not** auto-apply
bootstrap-manifest diffs (CoreDNS/kube-proxy/CNI), instead surfacing a reviewable diff post-upgrade so
manual edits aren't silently clobbered; a documented "Gate Talos Upgrades with Healthchecks" feature lets
a Cluster Template define Kubernetes Job healthchecks that block a rollout from proceeding until workloads
report healthy. Source: [Omni docs — Upgrade Omni Clusters](https://docs.siderolabs.com/omni/cluster-management/upgrading-clusters.md),
[Omni docs — Gate Talos Upgrades with Healthchecks](https://docs.siderolabs.com/omni/cluster-management/gate-talos-upgrades-with-healthchecks.md).
The doc also explicitly warns against deleting machines out-of-band or running `kubectl delete node` on
a control-plane node mid-upgrade, both of which can break etcd quorum irrecoverably without going through
Omni's own machine-lifecycle path — a real operational sharp edge worth carrying into implementation
planning regardless of which management plane is chosen.

**Licensing — re-verified, and Sidero Labs has since published explicit interpretive guidance.** Omni's
LICENSE file is still Business Source License 1.1, with the same Additional Use Grant text as before:
*"You may make non-production use of the Licensed Work, including testing and evaluation of the Licensed
Work itself, or personal use in a home lab environment. Use of the Licensed Work to host, run, test, or
support any environment on which Customer's own development, operations, or business depends is not
non-production use and requires a commercial license, regardless of how that environment is designated."*
Change Date `2030-08-04`, converting to MPL-2.0. Source: [`siderolabs/omni` LICENSE](https://github.com/siderolabs/omni/blob/main/LICENSE).
New since the prior research: a dedicated doc, "Production vs. Non-Production Use Under the Business
Source License," walks through edge cases in Sidero Labs' own words — explicitly confirming "Home labs
and other personal, non-commercial use" stays free regardless of scale or duration, and that the line is
organizational dependence, not environment labeling or node count. Source:
[Omni docs — Production vs. Non-Production Use](https://docs.siderolabs.com/omni/self-hosted/production-vs-non-production.md).
This directly reinforces, in more authoritative and detailed terms than the license text alone, that this
repo's use case (single-operator home lab, nothing commercial depending on it) is squarely non-production
and license-free.

**Proxmox-specific infrastructure provider.** `siderolabs/omni-infra-provider-proxmox` (the Omni-side
equivalent of CAPMOX) is actively maintained (88 stars, last push 2026-07-24, MPL-2.0), and auto-provisions
Talos VMs on a Proxmox VE cluster via a `MachineClass` of type `auto-provision`, driven declaratively from
Omni's own Cluster Template machinery. Source:
[`siderolabs/omni-infra-provider-proxmox` README](https://github.com/siderolabs/omni-infra-provider-proxmox/blob/main/README.md).
This is the provider issue #7's resolution already commits to using.

---

## 3. Other Talos-compatible management planes surveyed

### k0smotron's Remote Machine Provider — excluded, mechanically incompatible with Talos

k0smotron (`k0sproject/k0smotron`) ships a CAPI infrastructure provider, `RemoteMachine`/`RemoteCluster`,
that the prior research (#6) flagged as a promising SSH-based, Proxmox-provider-agnostic path to CAPI
lifecycle management. Re-examined here specifically for Talos compatibility: it is **not compatible, by
design, not merely unconfirmed**. k0smotron's own docs define the mechanism explicitly: *"A 'remote
machine' in this context means a machine (VM, bare metal) which can be remotely connected via SSH."* Its
`RemoteMachine` spec requires `address`, `port: 22`, `user`, and `sshKeyRef`; a `useSudo` field "wraps all
executed commands with sudo"; and its documented cleanup mechanism runs literal shell commands on the
target (`systemctl stop custom-service`, `/usr/local/bin/k0s etcd leave`, arbitrary custom scripts).
Source: [k0smotron docs — Remote Machine Provider](https://docs.k0smotron.io/stable/capi-remote/).
Talos Linux's own "Philosophy" documentation states, without qualification: *"We have no shell. We have
no SSH. We have none of the GNU utilities, not even a rollup tool such as busybox."* Source:
[Talos docs — Philosophy: Minimal](https://docs.siderolabs.com/talos/v1.13/learn-more/philosophy.md).
Omni's own troubleshooting docs independently corroborate this from the other direction, noting a
console/VNC fallback is needed during a stalled upgrade specifically *"since Talos does not allow SSH
access by design"* — source: [Omni docs — Upgrade Omni Clusters, "If a node appears stuck"](https://docs.siderolabs.com/omni/cluster-management/upgrading-clusters.md).
There is no code path by which k0smotron's SSH-executing infrastructure provider could apply bootstrap
data, run its lifecycle commands, or clean up a Talos machine — the transport it depends on does not
exist on the target OS. (k0smotron's own bootstrap/control-plane providers are also k0s-specific, not a
general Kubernetes-distribution-agnostic layer — the `RemoteMachine` infra provider is normally paired
with k0smotron's own `K0sControlPlane`/`K0sWorkerConfig`, not Talos's CABPT/CACPPT, reinforcing that this
was never a Talos-targeted feature to begin with.) **Excluded on this basis** — this is a protocol-level
incompatibility, not a maturity or Proxmox-support gap.

### `siderolabs/terraform-provider-talos` — a genuine "no management plane" alternative, narrower in scope

Unlike CABPT/CACPPT/Sidero Metal, this provider carries **no deprecation notice** and remains actively
maintained (282 stars, MPL-2.0, last push 2026-07-31). It "allows to generate configs for a Talos
cluster and apply them to the nodes, bootstrap nodes, check cluster health, and retrieve `kubeconfig` and
`talosconfig`" directly from Terraform/OpenTofu. Source:
[`siderolabs/terraform-provider-talos` docs index](https://github.com/siderolabs/terraform-provider-talos/blob/main/docs/index.md).
This is a fundamentally different shape than either CAPI or Omni: **no dedicated management cluster, no
single management host, no ongoing controller of any kind** — it's a one-shot (or repeatedly-applied)
config-generation-and-apply tool, conceptually adjacent to this repo's existing bootstrap-layer OpenTofu
usage (ADR 0001) rather than a competing cluster-lifecycle *product*. It does not itself provision VMs
(that still needs a separate provider, e.g. this repo's existing `bpg/proxmox`), and it provides **no
built-in upgrade orchestration** — OS and Kubernetes upgrades would be scripted by hand (`talosctl
upgrade`/`upgrade-k8s`, wrapped in Terraform or invoked directly), the same operational shape as the
"kubeadm/Ansible + `system-upgrade-controller`" bucket the prior research (#6) already covered and rated
as "closest to status quo, more manual glue." Included here for completeness since the ticket asked
specifically about the "no dedicated management plane" end of the operational-footprint spectrum, not
because it offers new capability over what #6 already surveyed.

### No further candidates found

No other actively-maintained, Talos-specific or Talos-compatible cluster-lifecycle tool was found beyond
the above. Rancher, Kamaji, Crossplane, vcluster, and plain kubeadm/Kubespray (all covered in #6) either
don't target Talos specifically or don't change their calculus based on the distro being Talos rather
than any other Kubernetes distribution — none surfaced Talos-specific integration work in this pass that
would justify re-surveying them here.

---

## Summary / comparison

| Dimension | CAPI + CABPT/CACPPT (+ CAPMOX) | Sidero Omni (self-hosted) |
|---|---|---|
| **Maintainer status** | Officially deprecated by Sidero Labs (Aug 2026); community-support-only going forward, though currently up to date with Talos 1.13/CAPI v1beta2 | Actively developed flagship product; docs and features expanding |
| **Node add/replace** | `TalosControlPlane`/`MachineDeployment` + CAPMOX `ProxmoxMachineTemplate`; immutable-replace model, same as any CAPI provider | Cluster Template UUID/machine-class edit + `omnictl cluster template sync`, or UI; Omni handles provisioning via `omni-infra-provider-proxmox` |
| **OS upgrade** | Talos's own `talosctl upgrade`/A-B rollback, triggered per-Machine by CAPI's replace-or-patch model; no CAPI-native orchestration beyond rolling `MachineTemplate` bumps | Built-in: per-machine-set rolling strategy, etcd-quorum-safe control-plane sequencing, node locking, healthcheck gating, etcd-backup checks |
| **Kubernetes upgrade** | `KubeadmControlPlane`/`TalosControlPlane.spec.version` bump; CAPI rolling replacement | Built-in, same orchestrator as OS upgrades; reviewable bootstrap-manifest diffs, `--dry-run`-equivalent preview |
| **Control-plane VIP** | Achievable (Talos native VIP or a hand-authored kube-vip static pod via `configPatches`), but **not built into any official CABPT/CACPPT/CAPMOX template** — DIY glue required | **Forbidden by design** — `cluster.vip`/`cluster.controlPlane.endpoint` are stripped/ignored; all external access permanently proxies through Omni |
| **Image customization** | Manual: pick/build a Talos image (Image Factory schematic or `image-builder`), reference by URL/version | Declarative: `systemExtensions`/`kernelArgs`/`patches` fields directly in the Cluster Template |
| **Secure remote access** | None built-in; whatever network reachability the infra provider's VMs have | SideroLink (WireGuard) mandatory for every managed machine; works across NAT |
| **Operational footprint** | A CAPI management cluster (control-plane + CABPT/CACPPT/CAPMOX controllers) | A single non-Kubernetes management host (or optional external etcd/HA tiers), explicitly *not* a Kubernetes cluster itself |
| **License/cost** | Free (Apache-2.0 CAPI, MPL-2.0 CABPT/CACPPT/CAPMOX) | Free for home-lab/non-production (BUSL Additional Use Grant, reaffirmed by Sidero's own interpretive guidance); commercial license required only if a business/production dependency exists |
| **Availability of the mgmt plane itself** | If the CAPI management cluster is down, no new lifecycle actions can be taken, but already-created clusters' own control planes (and their VIP) keep working unaffected | If Omni is down, already-running workloads are unaffected, but **all external access** (including this repo's ArgoCD hub reconciliation) pauses — the exact coupling ADR 0011/0012 already accepted |

**For a decision-maker choosing between these for this repo specifically:** the core tradeoff ADR
0011/0012 already reasoned through — Omni's proxy-only external access versus a directly-reachable
control-plane VIP — is real and re-confirmed, but it must now be weighed against a fact the prior
research didn't have: **the only way to get that directly-reachable VIP via CAPI-on-Talos runs through
tooling (CABPT/CACPPT) that Sidero Labs itself has publicly stepped back from maintaining**, in favor of
steering users toward the very tool (Omni) whose proxy model creates the tradeoff in the first place.
This doesn't make CAPI+CABPT/CACPPT non-functional — both providers are current with the latest Talos/CAPI
versions today, and CAPMOX itself remains fully healthy as a *kubeadm*-based provider — but it does mean
adopting CAPI-on-Talos now means adopting a stack its own maintainer has flagged as community-support-only,
for a capability (native VIP) that isn't even built into any official template and would need to be
hand-rolled regardless. k0smotron is not a viable substitute for reaching that same VIP capability, since
its only Proxmox-relevant infra provider (Remote Machine) cannot run against Talos nodes at all.
`terraform-provider-talos` is a legitimate lower-footprint alternative if a decision-maker wants to avoid
both Omni's proxy constraint and a CAPI management cluster, but it trades away all of Omni's built-in
upgrade orchestration, SideroLink remote access, and declarative image customization for hand-rolled
Terraform/scripting glue — closer in spirit to this repo's already-rejected "keep doing it by hand" status
quo than to either of the two purpose-built management planes compared above.

---

## Sources

- `siderolabs/cluster-api-bootstrap-provider-talos` — README (deprecation notice) — <https://github.com/siderolabs/cluster-api-bootstrap-provider-talos/blob/main/README.md>
- `siderolabs/cluster-api-bootstrap-provider-talos` — deprecation-notice commit — <https://github.com/siderolabs/cluster-api-bootstrap-provider-talos/commit/855be5eb428593eaa18a15530f07121c4a97c1e8>
- `siderolabs/cluster-api-bootstrap-provider-talos` — GitHub API (stars/activity/releases) — <https://api.github.com/repos/siderolabs/cluster-api-bootstrap-provider-talos>
- `siderolabs/cluster-api-control-plane-provider-talos` — README (deprecation notice, TalosControlPlane API) — <https://github.com/siderolabs/cluster-api-control-plane-provider-talos/blob/main/README.md>
- `siderolabs/cluster-api-control-plane-provider-talos` — open issues (#225, #262, etc.) — <https://github.com/siderolabs/cluster-api-control-plane-provider-talos/issues>
- `siderolabs/sidero` (Sidero Metal) — README (deprecation notice) — <https://github.com/siderolabs/sidero/blob/main/README.md>
- `kubernetes-sigs/cluster-api` — GitHub API (activity/latest release) — <https://api.github.com/repos/kubernetes-sigs/cluster-api>
- Cluster API Book — Provider List (still lists Talos as bootstrap/control-plane provider) — <https://cluster-api.sigs.k8s.io/reference/providers>
- `ionos-cloud/cluster-api-provider-proxmox` — Usage guide (kubeadm-based quickstart) — <https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/main/docs/Usage.md>
- `ionos-cloud/cluster-api-provider-proxmox` — default cluster template (kube-vip static pod via `KubeadmConfigSpec.files`) — <https://github.com/ionos-cloud/cluster-api-provider-proxmox/blob/main/templates/cluster-template.yaml>
- `ionos-cloud/cluster-api-provider-proxmox` — `templates/` directory listing (no Talos flavor) — <https://github.com/ionos-cloud/cluster-api-provider-proxmox/tree/main/templates>
- Talos Linux docs — `Layer2VIPConfig` reference (control-plane-only VIP) — <https://docs.siderolabs.com/talos/v1.13/reference/configuration/network/layer2vipconfig.md>
- Talos Linux docs — Static Pods (`machine.pods`) — <https://docs.siderolabs.com/talos/v1.13/configure-your-talos-cluster/images-container-runtime/static-pods.md>
- Talos Linux docs — Troubleshooting (control-plane endpoint options, incl. kube-vip) — <https://docs.siderolabs.com/talos/v1.13/troubleshooting/troubleshooting.md>
- Talos Linux docs — Philosophy ("no shell, no SSH") — <https://docs.siderolabs.com/talos/v1.13/learn-more/philosophy.md>
- Talos Linux docs — What is Talos Linux? — <https://docs.siderolabs.com/talos/v1.13/introduction/what-is-talos.md>
- Talos Linux docs — SideroLink — <https://docs.siderolabs.com/talos/v1.13/networking/siderolink.md>
- Talos Linux docs — Image Factory — <https://docs.siderolabs.com/talos/v1.13/learn-more/image-factory.md>
- Omni docs — What is Omni? — <https://docs.siderolabs.com/omni/overview/what-is-omni.md>
- Omni docs — Options for Running Omni (deployment models, blast radius) — <https://docs.siderolabs.com/omni/self-hosted/options-for-running-omni.md>
- Omni docs — Production vs. Non-Production Use Under the BSL — <https://docs.siderolabs.com/omni/self-hosted/production-vs-non-production.md>
- Omni docs — Talos Config Overrides (forbidden/ignored fields, incl. VIP) — <https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md>
- Omni docs — Introduction to Cluster Templates — <https://docs.siderolabs.com/omni/omni-cluster-setup/cluster-template.md>
- Omni docs — Cluster Templates reference (`systemExtensions`, `patches`, `kernelArgs`) — <https://docs.siderolabs.com/omni/reference/cluster-templates.md>
- Omni docs — Scale a Cluster Up or Down — <https://docs.siderolabs.com/omni/cluster-management/scale-your-cluster/scale-a-cluster-up-or-down.md>
- Omni docs — Upgrade Omni Clusters (unified OS/K8s upgrade orchestration) — <https://docs.siderolabs.com/omni/cluster-management/upgrading-clusters.md>
- Omni docs — Gate Talos Upgrades with Healthchecks — <https://docs.siderolabs.com/omni/cluster-management/gate-talos-upgrades-with-healthchecks.md>
- `siderolabs/omni` — LICENSE (BUSL 1.1 text) — <https://github.com/siderolabs/omni/blob/main/LICENSE>
- `siderolabs/omni` — GitHub API (activity) — <https://api.github.com/repos/siderolabs/omni>
- `siderolabs/omni-infra-provider-proxmox` — README — <https://github.com/siderolabs/omni-infra-provider-proxmox/blob/main/README.md>
- `siderolabs/omni-infra-provider-proxmox` — GitHub API (activity) — <https://api.github.com/repos/siderolabs/omni-infra-provider-proxmox>
- k0smotron docs — Remote Machine Provider (SSH-based mechanism) — <https://docs.k0smotron.io/stable/capi-remote/>
- `siderolabs/terraform-provider-talos` — docs index — <https://github.com/siderolabs/terraform-provider-talos/blob/main/docs/index.md>
- `siderolabs/terraform-provider-talos` — GitHub API (activity, no deprecation notice) — <https://api.github.com/repos/siderolabs/terraform-provider-talos>
- `kube-vip/kube-vip` — latest release (currency check) — <https://api.github.com/repos/kube-vip/kube-vip/releases/latest>
- Talos/Omni docs index (`llms.txt`) — <https://docs.siderolabs.com/llms.txt>
- catalyst repo (current-state context): `CONTEXT.md`, `docs/adr/0011-cluster-registration-cross-cluster-auth.md`,
  `docs/adr/0012-omni-deployment-model-availability.md`
- Sibling research: `docs/research/cluster-lifecycle-research.md` (branch `research/cluster-lifecycle-research`,
  [#6](https://github.com/aaronkyriesenbach/catalyst/issues/6)); `docs/research/loadbalancer-talos-research.md`
  (branch `research/loadbalancer-talos-research`, [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46))
- catalyst repo issues consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1) (wayfinder map),
  [#7](https://github.com/aaronkyriesenbach/catalyst/issues/7) (distro/lifecycle resolution — Talos + Omni,
  management-plane pick reopened), [#51](https://github.com/aaronkyriesenbach/catalyst/issues/51) (this research
  ticket), [#52](https://github.com/aaronkyriesenbach/catalyst/issues/52) (the grilling ticket this feeds)
