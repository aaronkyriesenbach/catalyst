# Research: LoadBalancer implementation for exposing per-cluster Gateway Services on Talos

**Ticket**: [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46) — feeds into
[#47, "Decide how traffic reaches the correct cluster across the multi-cluster ingress
topology"](https://github.com/aaronkyriesenbach/catalyst/issues/47) — part of the
["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: This repo already runs kube-vip today, in ARP mode, for both the control-plane API
server VIP (`192.168.53.200`) and the Traefik Service-type-`LoadBalancer` VIP (`192.168.53.201`),
with k3s's bundled ServiceLB explicitly disabled in favor of it (`cluster/kube-vip-daemonset.yaml`,
`cluster/traefik-config.yaml`, `cluster/README.md`). ADR 0009/#36 now commits every cluster
(platform, External workload, Internal workload) to its own independent Istio Gateway `Service`,
each needing the same stable LAN IP kube-vip already provides — but on Talos Linux + self-hosted
Sidero Omni (#7's resolution), not k3s. This document surveys, against primary sources only,
whether kube-vip's existing pattern carries over as-is, whether MetalLB offers anything kube-vip
doesn't, and where the installation mechanism should live given Omni's Cluster Templates. **It
does not decide anything** — the placement call is explicitly deferred to the grilling session in
[#47](https://github.com/aaronkyriesenbach/catalyst/issues/47), per this ticket's own instructions.

---

## TL;DR

- **kube-vip's DaemonSet + ARP mechanism is identical on Talos** — same manifest shape
  (`hostNetwork: true`, `NET_ADMIN`/`NET_RAW` capabilities, RBAC `ServiceAccount` instead of a
  kubeadm-style `hostPath` kubeconfig mount) as this repo already runs, confirmed both by
  kube-vip's own docs and by real user reports running it successfully on Talos in kube-vip's own
  issue tracker. The one Talos-specific wrinkle that matters: **Talos enforces the `baseline` Pod
  Security Admission profile on every namespace _except_ `kube-system`, which is exempted to
  `privileged`** — confirmed directly in Talos's own docs. Since this repo already runs kube-vip in
  `kube-system`, this repo's existing manifest needs **no PSA changes at all** to keep working on
  Talos. MetalLB, by contrast, installs to its own `metallb-system` namespace by default and
  **requires an explicit `privileged` PSA label** per MetalLB's own install docs — a requirement
  that several Talos users hit and had to work around, confirmed in MetalLB's own issue tracker.
- **Talos's native VIP feature (`Layer2VIPConfig`, exposed as `.machine.network.interfaces[].vip`)
  is explicitly, unambiguously control-plane-only** — Talos's own config reference states
  "Virtual IP configuration should be used only on controlplane nodes to provide virtual IP for
  Kubernetes API server. Any other use cases are not supported and may lead to unexpected
  behavior." It cannot be repurposed for a Service-type-`LoadBalancer` VIP, so it is not an
  alternative to kube-vip's Service-LB role at all — only, potentially, to its control-plane role.
- **A bigger finding than the ticket anticipated: on this repo's actual stack, _neither_ kube-vip's
  control-plane mode _nor_ Talos's native VIP is needed for the control-plane role, because
  self-hosted Sidero Omni (already adopted per #7) supersedes both.** Omni's own docs state it
  "automatically creates a highly available Kubernetes API endpoint" and that "all kubectl
  requests are routed through the Kubernetes API endpoint created by Omni" over its WireGuard
  (SideroLink) mesh — the same mechanism self-hosted and SaaS Omni both use. Omni's own
  config-override reference confirms this isn't optional: `cluster.controlPlane.endpoint` and
  `cluster.vip` are both forbidden/ignored fields in an Omni-managed cluster, specifically because
  "the concept of a cluster VIP does not apply since Omni exposes a managed external endpoint."
  This narrows kube-vip's real job in this repo, going forward, to **the Service-LB role only** —
  confirming the ticket's suspicion, but for a different and more decisive reason than "Talos has
  its own VIP feature."
- **kube-vip's ARP mode is not single-VIP-per-role.** Every `LoadBalancer` Service is watched and
  advertised independently via its own `kube-vip.io/loadbalancerIPs` annotation; kube-vip's own
  docs describe per-service leader election (`svc_election`) that can spread different Services'
  VIPs across different nodes. A cluster needing more than one Gateway Service (or any other
  LoadBalancer Service) is natively supported today, with no additional component.
- **MetalLB brings no capability kube-vip lacks for this repo's use case, and starts from a proven
  disadvantage here**: both L2 mode and kube-vip's ARP mode are the same underlying
  mechanism (leader-elected gratuitous ARP/NDP, single-node bottleneck, no ongoing load balancing
  across nodes) per each project's own docs — and kube-vip additionally already has a documented
  BGP mode, so "MetalLB for BGP's true load balancing" isn't a capability gap either. The
  Talos-specific PSA friction found above is a real, sourced cost MetalLB has that kube-vip (kept
  in `kube-system`) doesn't.
- **Flat Infra VLAN (`10.53.40.0/24`, #5) is a non-issue for ARP-mode L2 adjacency** — all three
  clusters' nodes already share one broadcast domain, so ARP-based VIPs for any cluster are
  reachable and electable across all of them with no routing/BGP relay required. The one real
  consequence: all VIPs across all three clusters draw from the same `/24`, so IP allocation must
  be coordinated by hand across clusters — there's no per-cluster VLAN boundary to fall back on to
  prevent an accidental collision.
- **Omni's Cluster Templates expose _three_ distinct places kube-vip's Service-LB DaemonSet could
  be installed, not two** — a Talos machine-config static pod (patch-scoped to the `ControlPlane`
  document), Omni's own **manifest-sync** feature (`kubernetes.manifests` on the `Cluster`
  document — applies once the Kubernetes API is healthy, independent of both Talos config _and_
  the GitOps hub), or an ordinary GitOps-hub-managed app. This third option is genuinely new
  information relevant to ADR 0009's stated premise that "this repo's stack has no mechanism for
  installing Kubernetes-level workloads at cluster-creation time" (see the note in Question 5) —
  flagged for #47, not resolved here.

---

## Question 1: Does kube-vip work the same way on Talos as it does on k3s today?

### The mechanism is identical

kube-vip's own docs describe exactly two installation shapes: a **static Pod** (for distros like
`kubeadm` that need the VIP to exist before the API server is reachable at all) and a
**DaemonSet** (for distros, k3s among them, that "can bring up a Kubernetes cluster without
depending on a pre-existing VIP" and add kube-vip afterward) — [kube-vip: DaemonSet
installation](https://kube-vip.io/docs/installation/daemonset/). This repo's current
`cluster/kube-vip-daemonset.yaml` already follows the DaemonSet shape: `hostNetwork: true`, a
`ServiceAccount`/RBAC binding instead of a static Pod's kubeadm-style
`hostPath: /etc/kubernetes/admin.conf` kubeconfig mount, `NET_ADMIN`/`NET_RAW` capabilities, and a
`node-role.kubernetes.io/control-plane` node affinity + toleration — this is verbatim the pattern
kube-vip's own DaemonSet doc shows for ARP mode (down to the exact environment variable names:
`vip_arp`, `cp_enable`, `svc_enable`, `vip_leaderelection`). Nothing about this shape is
k3s-specific; the doc frames it generically as "some Kubernetes distributions," not "k3s only."

Real-world confirmation that this pattern works on Talos specifically, not just in theory, comes
from kube-vip's own issue tracker: a user running kube-vip's DaemonSet in ARP mode on Talos Linux
reported "I have successfully used the setup below to assign ingress VIPs for several services,
without any issue" (the bug they were chasing was specific to the separate, unrelated _egress_
VIP feature, not core Service-LB ARP advertisement) —
[kube-vip/kube-vip#1158](https://github.com/kube-vip/kube-vip/issues/1158). A second user ran
into an unrelated BGP-mode CPU/iptables bug on Talos and resolved it by switching to ARP mode —
[kube-vip/kube-vip#1167](https://github.com/kube-vip/kube-vip/issues/1167). Neither report
surfaces any Talos-specific blocker for the DaemonSet+ARP shape this repo already uses.

### The one real Talos-specific constraint: Pod Security Admission

Talos automatically configures Kubernetes' Pod Security Admission (PSA) plugin. Talos's own docs
state the default configuration plainly: **"Talos... applies the `baseline` profile to all
namespaces, except for the `kube-system` namespace, which uses the `privileged` profile"** — with
the actual default `PodSecurityConfiguration` shown, `exemptions.namespaces: [kube-system]` —
[Talos docs: Pod Security](https://docs.siderolabs.com/kubernetes-guides/security/pod-security.md).
The `baseline` profile forbids exactly the things kube-vip's container needs
(`hostNetwork: true`, `NET_ADMIN`/`NET_RAW` capabilities) — Talos's own worked example in that
same doc shows a `hostNetwork: true` DaemonSet with elevated capabilities being silently blocked
from scheduling any pods under `baseline`, until the namespace is explicitly re-labeled
`privileged`.

This repo's kube-vip DaemonSet already lives in `namespace: kube-system`
(`cluster/kube-vip-daemonset.yaml`) — which Talos exempts to `privileged` by default. **No
manifest change is required for this reason alone.** This is worth stating explicitly because the
opposite turned out to be true for MetalLB (Question 3) — namespace placement is the difference
between "just works" and "needs an explicit PSA override" on Talos.

### Talos's native VIP feature: control-plane-only, by explicit design

Talos Linux ships a first-party "Virtual (shared) IP" feature, configured under
`machine.network.interfaces[].vip` (backed by the `Layer2VIPConfig` document in the newer
per-link config-document API) — [Talos docs: Virtual (shared)
IP](https://docs.siderolabs.com/talos/v1.10/networking/vip). Mechanically it's the same idea as
kube-vip's ARP mode: "the controlplane machines vie for control of the shared IP address using
etcd elections... [the VIP] will be announced from only one node at a time using gratuitous ARP
announcements for IPv4" — [Talos config reference:
`Layer2VIPConfig`](https://docs.siderolabs.com/talos/v1.13/reference/configuration/network/layer2vipconfig.md).

Critically, both the prose doc and the machine-readable config reference say this is
**restricted to the control-plane API-server role, by design, not just by convention**. The
`Layer2VIPConfig` reference's own description field states it outright: _"Virtual IP configuration
should be used only on controlplane nodes to provide virtual IP for Kubernetes API server. Any
other use cases are not supported and may lead to unexpected behavior."_ There is no path from
this feature to a Service-type-`LoadBalancer` VIP — it doesn't watch Kubernetes `Service` objects
at all, it only manages one address bound to etcd/kube-apiserver health on control-plane nodes.
So, on the narrow question the ticket posed ("is Talos's native VIP a first-party alternative to
kube-vip for the control-plane role, leaving kube-vip only needed for the Service-LB role") — the
answer for the _control-plane_ half is yes in principle, but see the next section for why it
doesn't actually end up mattering in this repo's stack.

### The bigger finding: Omni already owns the control-plane endpoint problem

This repo's cluster-lifecycle decision (#7) already committed to **self-hosted Sidero Omni**, not
bare Talos. Omni's own top-level docs describe exactly the control-plane-HA problem kube-vip and
Talos's native VIP both solve, and state Omni solves it itself: _"Omni automatically creates a
highly available Kubernetes API endpoint, transparently provides secure encryption, and automates
Kubernetes and OS upgrades"_ — [Omni docs: What is
Omni?](https://docs.siderolabs.com/omni/overview/what-is-omni.md). The "Use Kubectl With Omni"
guide confirms the mechanics: _"All `kubectl` requests are routed through the Kubernetes API
endpoint created by Omni. Omni validates access using the configured OpenID Connect (OIDC)
provider..."_ — [Omni docs: Use Kubectl With
Omni](https://docs.siderolabs.com/omni/getting-started/use-kubectl-with-omni.md). This isn't a
SaaS-only convenience: every Talos machine Omni manages (self-hosted or SaaS) maintains an
outbound WireGuard tunnel to the Omni instance (SideroLink) as a baseline, non-optional part of
machine registration — [Omni docs: Getting
Started](https://docs.siderolabs.com/omni/getting-started/getting-started.md) (WireGuard endpoint
and port requirements listed as a hard prerequisite), [Omni docs: How configuration works in
Omni](https://docs.siderolabs.com/omni/omni-cluster-setup/how-configuration-works-in-omni.md)
(SideroLink kernel args "set automatically by Omni... not user-editable"). Machine-to-machine
access (e.g. for automation, not a human's browser-based OIDC login) still routes through this
same Omni-managed endpoint, just with a Kubernetes-`ServiceAccount`-token-based kubeconfig instead
of an OIDC one — [Omni docs: Create a Kubeconfig for a Kubernetes Service
Account](https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-kubeconfig-for-a-service-account.md).

Omni's own config-override reference makes this non-negotiable, not just a convenience a user
could opt out of: `cluster.controlPlane.endpoint` is listed as forbidden/ignored — _"Omni
provides the cluster endpoint (VIP / external endpoint). User-defined endpoints are not
allowed"_ — and `cluster.vip` is listed separately as forbidden — _"The concept of a cluster VIP
does not apply since Omni exposes a managed external endpoint"_ — [Omni docs: Talos Config
Overrides](https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md). In
other words: once a cluster is Omni-managed (as every cluster in this repo now will be, per #7),
you cannot configure Talos's own native VIP for the control-plane role even if you wanted to —
Omni's reconciler strips it. **This means kube-vip's control-plane mode is not just redundant with
Talos's native VIP feature — both are redundant with, and in Talos's case actively overridden by,
Omni itself.** kube-vip's _only_ remaining job in this stack, confirmed from three independent
angles (kube-vip's own architecture docs, Talos's own VIP-scope restriction, and Omni's own
config-override list), is the Service-LB role — exactly the role this ticket and #36/#47 actually
need solved for the Istio Gateway Services.

One caveat worth flagging for #47, not resolved here: this finding is about the _control-plane
API_ endpoint specifically. It says nothing about whether other in-cluster consumers (e.g. the
GitOps hub reaching workload clusters as remote destinations, ADR 0007's still-open registration
question) end up using Omni-issued kubeconfigs (and therefore also ride on Omni's managed
endpoint) or some other direct-network mechanism — that's ADR 0007's open question, not this
one's.

---

## Question 2: Does kube-vip's ARP mode support multiple distinct Service VIPs per cluster?

Yes — this is how kube-vip's Service-LB feature is designed to work, not an edge case. kube-vip's
own docs describe the mechanism as a per-`Service` watcher: _"a watcher is enabled on all services
that match the type `loadBalancer`... [it] will only advertise a kubernetes service once the
`metadata.annotations["kube-vip.io/loadbalancerIPs"]`... has been populated"_ — [kube-vip:
Kubernetes Load-Balancer
service](https://kube-vip.io/docs/usage/kubernetes-services/). Each `LoadBalancer` Service
carries its own annotation value, so a cluster with N Gateway (or other) `LoadBalancer` Services
gets N independently-watched, independently-advertised VIPs — this repo's own current config
already relies on exactly this per-Service-annotation mechanism for the single Traefik VIP
(`kube-vip.io/loadbalancerIPs: 192.168.53.201` in `cluster/traefik-config.yaml`), and nothing
about the mechanism caps it at one.

kube-vip goes further and explicitly supports **spreading different Services' VIPs across
different leader nodes**, not pinning every VIP to whichever single node wins the very first
leader election: _"instead of one node becoming the leader for all services an election is held
across all kube-vip instances and the leader from that election becomes the holder of that
service... every service can end up on a different node"_ — enabled via the `svc_election`
config flag — [kube-vip: Kubernetes Load-Balancer
service](https://kube-vip.io/docs/usage/kubernetes-services/#load-balancing-load-balancers-when-using-arp-mode-yes-you-read-that-correctly-kube-vip-v050). The same doc also confirms multiple
Services can even share one IP on different ports if ever useful. There is no "single-VIP-per-role"
ceiling in ARP mode — it is fundamentally a per-Service, many-VIPs mechanism, which matters
directly if a cluster in this repo's topology ever needs more than the one Istio Gateway Service
the ticket poses as the immediate case.

---

## Question 3: MetalLB (L2 and BGP) vs kube-vip's proven track record here

### L2 mode is the same mechanism as kube-vip's ARP mode, with the same limitations

MetalLB's own docs describe L2 mode identically to how kube-vip describes ARP mode: _"one node
assumes the responsibility of advertising a service to the local network... MetalLB responds to
ARP requests for IPv4 services"_, single-leader, single-node-bandwidth-bottlenecked, gratuitous
("unsolicited") L2 packets for failover, typically a few seconds — [MetalLB: MetalLB in layer 2
mode](https://metallb.io/concepts/layer2/). This is not a different capability from what kube-vip
already provides in ARP mode; it's the same electee-and-gratuitous-ARP pattern, described almost
identically by both projects' own docs.

### BGP mode is real, but kube-vip already has it too

MetalLB's BGP mode does offer something L2/ARP mode structurally cannot: genuine multi-node
load-spreading via router ECMP, at the cost of "BGP-based load balancing does not react
gracefully to changes in the backend set" (existing connections reset on any node-set change) —
[MetalLB: MetalLB in BGP mode](https://metallb.io/concepts/bgp/). This is a legitimate MetalLB
capability — but it is not unique to MetalLB. kube-vip's own docs describe an equivalent built-in
BGP mode (`--bgp`, `bgp_enable`, `bgp_routerid`, `bgp_peers`) for both the static-Pod and DaemonSet
installation shapes, with the same peer/AS/router-ID configuration shape MetalLB uses — [kube-vip:
Static Pods — BGP](https://kube-vip.io/docs/installation/static/#bgp), [kube-vip: DaemonSet — BGP
Example](https://kube-vip.io/docs/installation/daemonset/#bgp-example-for-daemonset). So "adopt
MetalLB for BGP's true load balancing" is not a capability kube-vip lacks — it would require the
same prerequisite either way (a BGP-speaking LAN gateway/router to peer with), which this research
did not find confirmed one way or the other for this repo's current UniFi gateway hardware; that
capability check (not a kube-vip-vs-MetalLB question) is the actual gate on BGP mode being usable
at all here, regardless of which tool implements it.

### MetalLB carries a confirmed, sourced Talos-specific cost kube-vip (as configured here) doesn't

MetalLB's own installation docs are explicit that its speaker needs elevated permissions and that,
on any Kubernetes version enforcing Pod Security Admission, _"the namespace MetalLB is deployed to
must be labelled with[:] `pod-security.kubernetes.io/enforce: privileged`"_ (plus `audit`/`warn`)
— [MetalLB: Installation](https://metallb.io/installation/#installation-with-helm) — and that its
manifests/Helm chart deploy to the `metallb-system` namespace by default, which Talos does **not**
exempt the way it exempts `kube-system` (Question 1). Real users hit exactly this on Talos:
_"metallb requires privileged permissions on namespace... you can create namespace for
metallb-system with these permission..."_ —
[metallb/metallb#2676](https://github.com/metallb/metallb/issues/2676) — and an earlier, now-fixed
MetalLB release simply crash-looped its speaker on Talos until the namespace was labeled or Talos
was configured with an explicit PSA exemption, diagnosed against Talos's own baseline-profile
docs: _"Talos docs by default enforce the baseline policy, and... baseline doesn't allow the
`NET_RAW` [capability]. Either labeling the namespace or adding it to the Talos exemptions should
work"_ — [metallb/metallb#1457](https://github.com/metallb/metallb/issues/1457). This is a real,
sourced, Talos-specific integration cost that this repo's existing kube-vip pattern (kept in
`kube-system`) simply doesn't have, because it was never going to be labeled anything other than
`kube-system` to begin with.

### No compelling reason found to introduce a second tool

Putting the above together: MetalLB's L2 mode is functionally the same mechanism kube-vip's ARP
mode already provides and this repo already runs successfully; MetalLB's BGP mode is matched
capability-for-capability by kube-vip's own (also built-in) BGP mode, gated on the same unverified
router prerequisite either way; and MetalLB additionally carries a confirmed Talos PSA integration
cost kube-vip doesn't have here. This research did not find a capability, a Talos compatibility
advantage, or an operational-maturity argument in MetalLB's favor over simply replicating the
existing kube-vip DaemonSet pattern across the two new clusters. The one door this research
leaves open, deliberately not walked through: **if a future need for genuine multi-node,
ECMP-style load spreading across an Istio Gateway Service's backends turns out to matter, that's a
BGP-mode question first** (available in kube-vip already) **and a "does our LAN gateway speak
BGP" question second** (unverified for either tool) — not, on the evidence gathered here, a reason
to adopt MetalLB specifically.

---

## Question 4: Interaction with the network-segmentation decision (#5 — flat Infra VLAN, `10.53.40.0/24`)

Both kube-vip's ARP mode and Talos's native VIP feature have the identical, explicitly-stated
requirement: **the electing nodes must share one Layer-2 broadcast domain**, since gratuitous
ARP/NDP is how failover and initial advertisement both work — Talos's own docs state it as a hard
requirement for its native VIP ("controlplane nodes must share a layer 2 network, and the virtual
IP must be assigned from that shared network subnet... connected via a switch, with no router in
between them") — [Talos docs: Virtual (shared)
IP](https://docs.siderolabs.com/talos/v1.10/networking/vip) — and MetalLB's L2-mode doc states the
same property from the opposite direction ("MetalLB relies on memberlist... it cannot interoperate
with third-party VRRP-aware routers") — [MetalLB: MetalLB in layer 2
mode](https://metallb.io/concepts/layer2/).

The network-segmentation decision already put every cluster's nodes — platform, External
workload, and Internal workload alike — on one flat, unsubdivided Infra VLAN (`10.53.40.0/24`,
zone "Lab"), specifically because it's a single trust tier with no further internal subdivision
(resolution comment on
[#5](https://github.com/aaronkyriesenbach/catalyst/issues/5)). This means the L2-adjacency
requirement is **already satisfied by construction** for every VIP any of the three clusters might
need — there's no VLAN boundary between clusters' nodes that ARP/gratuitous-ARP would need to
cross, and therefore no BGP relay or router-level workaround is forced by the segmentation
decision the way it might be if clusters were split across separate VLANs.

The one thing the segmentation decision does hand off as a bookkeeping concern, not a technical
blocker: because all three clusters' nodes (and therefore all three clusters' VIPs) sit in the
same `/24`, **VIP address allocation must be coordinated by hand across all three clusters** —
there is no natural per-cluster VLAN partition to fall back on if two clusters' operators
(or the same operator, working on two clusters at different times) pick the same IP by accident.
This is worth carrying into #47's IP-assignment discussion as a concrete constraint, not a
blocker: whatever mechanism ends up owning "which cluster gets which Gateway Service IP" needs a
single, cross-cluster-aware allocation list, not per-cluster-independent ranges.

---

## Question 5: Interaction with Omni/Talos Cluster Templates (#7's resolution)

This repo's #7 resolution already commits to Talos + self-hosted Sidero Omni, with clusters
defined as Omni **Cluster Templates** — multi-document YAML with `Cluster`/`ControlPlane`/
`Workers`/`Machine` documents, scoped Talos config patches, and a `systemExtensions` list, synced
via `omnictl cluster template sync` — [Omni docs: Introduction to Cluster
Templates](https://docs.siderolabs.com/omni/omni-cluster-setup/cluster-template.md), [Omni docs:
Cluster Templates
reference](https://docs.siderolabs.com/omni/reference/cluster-templates.md). Against that
mechanism, this research found **three** distinct places kube-vip's Service-LB DaemonSet could be
installed — not the two ("Talos static pod via machine config" vs. "regular GitOps-hub-managed
app") the ticket posed:

1. **A Talos machine-config static pod, expressed as an Omni Cluster Template patch.** Talos
   supports arbitrary static pods directly in machine config, under `machine.pods`, rendered by
   the `kubelet` via a local HTTP server rather than the Kubernetes API — _"Static pods are run
   directly by the `kubelet` bypassing the Kubernetes API server checks and validations... some
   workloads need to run before the Kubernetes API server is available"_ — [Talos docs: Static
   Pods](https://docs.siderolabs.com/talos/v1.13/configure-your-talos-cluster/images-container-runtime/static-pods.md).
   Cluster Templates support arbitrary "Talos machine configuration strategic patch" content
   scoped to the `ControlPlane` document (i.e. applied to every control-plane machine) — [Omni
   docs: Cluster Templates reference — `patches`](https://docs.siderolabs.com/omni/reference/cluster-templates.md#patches)
   — so a `machine.pods` static-pod entry for kube-vip is expressible today as an ordinary
   `ControlPlane`-scoped patch, no different in kind from the `systemExtensions` list this repo's
   #7 resolution already plans to use for `iscsi-tools`. **Caveat**: this research found no
   confirmed real-world report (in kube-vip's own issue tracker or Talos's own docs) of anyone
   running kube-vip specifically as a Talos-native static pod this way — every Talos success report
   found (Question 1) used the DaemonSet shape instead. Static-pod kube-vip on Talos is
   plausible by mechanism but empirically unconfirmed; DaemonSet kube-vip on Talos is both what
   this repo already runs and what's actually been reported working.
2. **Omni's own manifest-sync feature** — a mechanism this research did not expect to find,
   genuinely distinct from both options above. A `Cluster` document's `kubernetes.manifests` field
   lets a Cluster Template embed raw Kubernetes manifests (inline or by file) that Omni stores and
   applies directly, **once the Kubernetes API is available and the cluster reports healthy** —
   explicitly pitched by Omni's own docs as "useful for bootstrapping workloads like Argo CD,
   custom CNI, or any other application you want running immediately after a cluster is created" —
   [Omni docs: Sync Kubernetes
   Manifests](https://docs.siderolabs.com/omni/cluster-management/sync-kubernetes-manifests.md).
   It supports a `full` sync mode that keeps reconciling the manifest against the template
   (closer to a lightweight, Omni-native GitOps loop than a one-shot bootstrap script) — meaning
   kube-vip's DaemonSet + RBAC could be declared once, in the Cluster Template, and stay
   continuously reconciled by Omni itself, without ever touching the GitOps hub or Talos machine
   config. This sits genuinely between the other two options: later in the boot sequence than a
   Talos static pod (it waits for a healthy Kubernetes API — fine for kube-vip's Service-LB role,
   since Omni itself, not kube-vip, already owns control-plane HA per Question 1), but earlier
   and more self-contained than the GitOps hub (no dependency on ArgoCD having been installed and
   registered against the new cluster yet).
3. **An ordinary GitOps-hub-managed app**, the same placement ADR 0009 chose for Istio — an
   `apps/*.ts` `AppConfig` reconciled by the platform cluster's ArgoCD instance onto each spoke
   cluster, contingent on whatever #42 decides for multi-cluster app targeting.

**Flag for #47, not resolved here**: ADR 0009 states, as part of its reasoning for putting Istio
on the GitOps hub, that _"this repo's stack has no mechanism for installing Kubernetes-level
workloads at cluster-creation time — Omni's role is strictly machine-level (Talos config,
`systemExtensions`)"_. Option 2 above (Omni's manifest-sync feature) is evidence that premise is
no longer fully accurate — Omni does have a documented, first-party mechanism for installing
Kubernetes-level workloads tied to cluster creation, distinct from both machine-level config and
the GitOps hub. This doesn't reopen ADR 0009's actual decision (Istio's placement rests on ambient
mode not gating basic cluster function, which is a separate, still-valid argument for using the
hub regardless of what else is available), but it does mean **#47 has a third real option on the
table for kube-vip specifically**, not just the two the ADR's own bootstrap-mechanism framing
implied were exhaustive.

---

## Recommendation

None — by design. This ticket's own instructions, and the wayfinder map's split between research
and grilling tickets, put the actual placement/tooling decision in [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47), to be worked
through with the human. What this research does contribute to that session:

- kube-vip's existing pattern (DaemonSet, ARP, `kube-system`) carries over to Talos with no
  changes needed, confirmed both in kube-vip's own docs and in real Talos deployments reported in
  its issue tracker — replicating it per-cluster is a well-trodden path, not a leap.
- Nothing surveyed makes a case for MetalLB over continuing with kube-vip; if anything, MetalLB's
  default namespace runs into a confirmed, sourced Talos PSA snag that this repo's existing
  kube-vip convention (staying in `kube-system`) never triggers.
- The control-plane VIP question the ticket raised turned out to already be settled one layer
  up, by Omni — which changes what kube-vip is actually needed _for_ in this stack (Service-LB
  only), independent of whichever install mechanism #47 lands on.
- #47 has three real candidate placements for kube-vip's Service-LB role — Talos static pod,
  Omni manifest-sync, or GitOps hub — each with different bootstrap-ordering and reconciliation
  tradeoffs surfaced above, plus the still-open BGP-router-capability question if true multi-node
  load spreading is ever wanted.

---

## Sources

- kube-vip — DaemonSet installation — <https://kube-vip.io/docs/installation/daemonset/>
- kube-vip — Static Pods installation — <https://kube-vip.io/docs/installation/static/>
- kube-vip — K3s usage — <https://kube-vip.io/docs/usage/k3s/>
- kube-vip — Kubernetes Load-Balancer service — <https://kube-vip.io/docs/usage/kubernetes-services/>
- kube-vip — Architecture — <https://kube-vip.io/docs/about/architecture/>
- kube-vip GitHub issue — Talos Linux with kube-vip — <https://github.com/kube-vip/kube-vip/issues/1167>
- kube-vip GitHub issue — Egress via ARP mode on Talos Linux — <https://github.com/kube-vip/kube-vip/issues/1158>
- kube-vip GitHub — latest release (currency check) — <https://api.github.com/repos/kube-vip/kube-vip/releases/latest> (`v1.2.3`, vs. this repo's pinned `v1.1.2`)
- MetalLB — MetalLB in layer 2 mode — <https://metallb.io/concepts/layer2/>
- MetalLB — MetalLB in BGP mode — <https://metallb.io/concepts/bgp/>
- MetalLB — Installation — <https://metallb.io/installation/>
- MetalLB GitHub issue — Unable to use MetalLB on TalosOS linux v.1.9.3 on Proxmox — <https://github.com/metallb/metallb/issues/2676>
- MetalLB GitHub issue — talos v1.1/Kubernetes v.1.24.2/MetalLB pod security issues — <https://github.com/metallb/metallb/issues/1457>
- MetalLB GitHub issue — Unable to use MetalLB on TalosOS linux (v0.15.2) — <https://github.com/metallb/metallb/issues/2813>
- Talos Linux docs — Virtual (shared) IP — <https://docs.siderolabs.com/talos/v1.10/networking/vip>
- Talos Linux docs — `Layer2VIPConfig` reference — <https://docs.siderolabs.com/talos/v1.13/reference/configuration/network/layer2vipconfig.md>
- Talos Linux docs — Static Pods — <https://docs.siderolabs.com/talos/v1.13/configure-your-talos-cluster/images-container-runtime/static-pods.md>
- Talos Linux docs — Pod Security (PSA defaults) — <https://docs.siderolabs.com/kubernetes-guides/security/pod-security.md>
- Talos/Omni docs index (`llms.txt`) — <https://docs.siderolabs.com/llms.txt>
- Omni docs — What is Omni? — <https://docs.siderolabs.com/omni/overview/what-is-omni.md>
- Omni docs — Use Kubectl With Omni — <https://docs.siderolabs.com/omni/getting-started/use-kubectl-with-omni.md>
- Omni docs — Getting Started (WireGuard/SideroLink prerequisites) — <https://docs.siderolabs.com/omni/getting-started/getting-started.md>
- Omni docs — How configuration works in Omni — <https://docs.siderolabs.com/omni/omni-cluster-setup/how-configuration-works-in-omni.md>
- Omni docs — Create a Kubeconfig for a Kubernetes Service Account — <https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-kubeconfig-for-a-service-account.md>
- Omni docs — Talos Config Overrides — <https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md>
- Omni docs — Introduction to Cluster Templates — <https://docs.siderolabs.com/omni/omni-cluster-setup/cluster-template.md>
- Omni docs — Cluster Templates reference — <https://docs.siderolabs.com/omni/reference/cluster-templates.md>
- Omni docs — Create a Patch for Cluster Machines — <https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-patch-for-cluster-machines.md>
- Omni docs — Sync Kubernetes Manifests — <https://docs.siderolabs.com/omni/cluster-management/sync-kubernetes-manifests.md>
- catalyst repo (current-state context): `cluster/kube-vip-daemonset.yaml`, `cluster/kube-vip-rbac.yaml`,
  `cluster/traefik-config.yaml`, `cluster/README.md`, `CONTEXT.md`, `docs/adr/0009-ingress-istio-no-mesh-span.md`
- catalyst repo issues/resolutions consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)
  (wayfinder map), [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5) (network
  segmentation resolution), [#7](https://github.com/aaronkyriesenbach/catalyst/issues/7)
  (k8s distro/cluster-lifecycle resolution — Talos + self-hosted Omni), [#21](https://github.com/aaronkyriesenbach/catalyst/issues/21)
  (service mesh resolution — Istio ambient), [#36](https://github.com/aaronkyriesenbach/catalyst/issues/36)
  (ingress/routing-layer resolution — ADR 0009), [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47)
  (follow-on grilling ticket this research feeds)
- Sibling research: `docs/research/network-segmentation-research.md` (branch
  `research/network-segmentation-research`, [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5));
  `docs/research/gateway-impl-research.md` (branch `research/gateway-impl-research`,
  [#35](https://github.com/aaronkyriesenbach/catalyst/issues/35))
