# Research: Network Segmentation / IPAM Reference Architecture for Home + Homelab

Ticket: [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5), part of the
"Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).
Complements the prior hardware-capability research on
[branch `research/unifi-segmentation-research`](https://github.com/aaronkyriesenbach/catalyst/blob/research/unifi-segmentation-research/docs/research/unifi-segmentation-research.md)
(issue [#4](https://github.com/aaronkyriesenbach/catalyst/issues/4)), which is skimmed for context here but not
re-derived.

## TL;DR

- **Segmentation-by-function is a real, well-documented enterprise control**, not folklore. NIST SP 800-53
  Rev 5's boundary-protection control family (SC-7 and its enhancements) codifies it directly: separate
  subnets to isolate functions (SC-7(29)), isolate system components performing different business
  functions (SC-7(21)), and — most on-point for this question — **isolate security/management tooling from
  everything else via physically separate subnetworks specifically to limit blast radius if a host is
  compromised** (SC-7(13)). CISA's 2025 zero-trust microsegmentation guidance states the underlying rationale
  in plain language: segmentation "reduc[es] the blast area that a compromised resource can impact" and
  "reduc[es] the surface for lateral movement of adversaries that have breached networks."
- **Storage/NAS isolation is a real enterprise pattern, but its most commonly *cited* rationale is not
  primarily security — it's performance/broadcast-domain isolation, with security as a secondary,
  protocol-specific concern.** VMware's own iSCSI best-practices guide and TrueNAS's own networking docs
  both independently recommend a dedicated VLAN for iSCSI, and both give the same two reasons: (1) storage
  protocols are latency- and oversubscription-sensitive, so a shared/noisy broadcast domain degrades
  performance and can trigger retransmit storms; and (2) **iSCSI traffic is unencrypted on the wire**, so
  isolating it limits who can snoop/spoof/attempt CHAP or LUN-discovery attacks against it. NFS has an
  analogous protocol-exposure story (export-list trust, historically weak default auth) but the isolation
  literature leans much harder on iSCSI specifically. This is a legitimate justification, but it is a
  narrower one than "blast radius" — see the Recommendation section for how far it's worth taking at
  single-operator scale.
- **Home networks are explicitly called out by NIST as *usually flat/unsegmented*, and that's treated as the
  problem, not the norm to defend.** NIST SP 1800-15 ("Securing Small-Business and Home IoT Devices") states
  outright that these networks "are typically flat (unsegmented), predominantly connected via Wi-Fi-enabled
  devices, and managed by" non-experts — and the entire practice guide exists to fix that via
  function-based trust zones. This is the most directly on-point primary source for "home network"
  specifically (as opposed to generic enterprise guidance), and it independently arrives at the same
  tier-by-function model as the enterprise literature, just scaled down.
- **A commonly-recommended tier taxonomy across enterprise and home-scale guidance converges on roughly:**
  Management/out-of-band (highest trust, most isolated) → Trusted/Internal (personal devices, family) →
  Server/Infra (workloads, cluster, NAS) → IoT (least trusted "smart" devices) → Guest/Untrusted (fully
  isolated, internet-only). Guest and IoT are commonly *separate* zones because their risk models differ
  (Guest = untrusted people with a phone; IoT = trusted-by-default vendor firmware you don't control), though
  both usually get similarly strict "default deny inbound and east-west" treatment. Management/out-of-band
  planes (hypervisor host BMC/web UI, gateway admin plane) are the one tier that stricter guidance isolates
  even from the "trusted" infra tier, on the reasoning that compromising the thing that configures the
  network *is* total compromise, so its exposure should be strictly smaller than infra's.
- **Kubernetes itself does not require a dedicated VLAN, but it does have exactly one hard constraint worth
  knowing:** the Kubernetes network model requires that all Pods reach all other Pods without NAT — a pure
  L3 requirement, satisfiable across any number of VLANs/subnets as long as routing exists. Whether that
  routing needs *Layer 2 adjacency* (same VLAN) depends entirely on the CNI's backend: encapsulating backends
  (Flannel's default `vxlan`, Cilium's default VXLAN/Geneve tunnel mode) work across any L3-routed topology
  with zero VLAN constraint; non-encapsulated "direct routing" backends (Flannel's `host-gw`, Cilium's
  native-routing without a BGP daemon) **do** require the nodes to share an L2 broadcast domain (i.e., the
  same VLAN) unless a BGP-speaking router is added to distribute pod-CIDR routes. This is the one place
  "running Kubernetes vs. a single server" changes the segmentation math — it constrains which CNI backend
  choices are compatible with splitting cluster nodes across VLANs, not whether segmentation is possible.
- **A standards body independently agrees full segmentation rigor is an elective uplift, not a baseline, at
  this scale.** CIS Controls v8.1 scopes its two safeguards closest to "segment by function"/"segment
  storage by sensitivity" (13.4 and 3.12) to **Implementation Groups 2 and 3 only** — explicitly excluded
  from IG1, CIS's own "essential cyber hygiene" tier for resource-constrained organizations. This is a
  concrete, sourced data point (not just this research's opinion) that treating full network segmentation as
  optional at single-operator scale isn't skipping a baseline — it's declining a deliberate uplift.
- **Opinionated take (see Recommendation):** the enterprise storage-isolation rationale is legitimate but its
  *marginal* value drops fast once you're a single operator with no compliance driver and no adversary who
  specifically targets you — the blast-radius argument for storage is real but is a special case of "isolate
  anything privileged," not a categorically different concern deserving its own tier by default. The
  management/out-of-band plane argument is the one that holds up fully undiminished at any scale, because it
  protects against a single mistake (not a sophisticated attacker) causing total loss of control.

## Question 1: Is segmentation-by-function an actual enterprise standard, and does storage specifically warrant it?

### The standard: NIST SP 800-53 boundary protection (SC-7 family)

NIST SP 800-53 Rev 5 (the control catalog underlying FedRAMP, most US federal ATOs, and widely used as a
baseline even outside government) has a whole family of controls under **SC-7 "Boundary Protection"**
(source: [NIST SP 800-53 Rev 5 catalog, OSCAL JSON](https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json),
cross-checked against the [official catalog page](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)):

- **SC-7** (base control): "Monitor and control communications at the external managed interfaces to the
  system and at key internal managed interfaces"; connect to external networks/systems "only through managed
  interfaces ... arranged in accordance with an organizational security and privacy architecture." Guidance
  explicitly names subnetworks that are physically/logically separated from internal networks as "DMZs."
- **SC-7(1) Physically Separated Subnetworks** — separation enforced at the physical layer, not just VLAN
  tagging.
- **SC-7(13) Isolation of Security Tools, Mechanisms, and Support Components** — "Isolate [security tools]
  from other internal system components by implementing physically separate subnetworks with managed
  interfaces." Guidance: this is "useful in isolating computer network defenses from critical operational
  processing networks to prevent adversaries from discovering the analysis and forensics techniques
  employed" — i.e., a management/tooling-plane isolation rationale.
- **SC-7(21) Isolation of System Components** — "Employ boundary protection mechanisms to isolate [components]
  supporting [different mission/business functions]." Guidance: "isolation limits unauthorized information
  flows among system components," "provides enhanced protection that limits the potential harm from hostile
  cyber-attacks and errors" — this is the direct textual source of the "blast radius" framing.
- **SC-7(22) Separate Subnets for Connecting to Different Security Domains** — subnet decomposition "helps to
  provide the appropriate level of protection for network connections to different security domains."
- **SC-7(29) Separate Subnets to Isolate Functions** — explicitly: "Separating critical system components and
  functions from other noncritical system components and functions through separate subnetworks may be
  necessary to reduce susceptibility to a catastrophic or debilitating breach." (The control's own example is
  literally "physically separating the command and control function from the in-flight entertainment
  function ... in a commercial aircraft" — i.e., function-based isolation regardless of whether either side is
  individually "high risk.")

This is the primary-source backbone for "enterprises really do segment by function, and the stated reason is
blast-radius/lateral-movement limitation, not just performance." None of these controls single out storage —
they're generic to "different function = candidate for its own segment," which matters for the answer below.

### CIS Controls v8.1: segmentation is explicitly gated to higher "Implementation Groups"

One more standards-body data point is directly useful for the "is this overkill at single-operator
scale" half of the question. CIS Critical Security Controls v8.1 has two safeguards that map almost
exactly onto "segment by function" and "segment storage by sensitivity":

- **Safeguard 13.4, "Perform Traffic Filtering Between Network Segments"** (under Control 13,
  Network Monitoring and Defense)
- **Safeguard 3.12, "Segment Data Processing and Storage Based on Sensitivity"** (under Control 3,
  Data Protection) — "Do not process sensitive data on enterprise assets intended for lower
  sensitivity data," which is the closest CIS analogue to "should the NAS be walled off."

Both are confirmed (via CIS's Implementation Group mapping, cross-checked against
[csf.tools's CIS Controls v8.1 reference pages](https://csf.tools/reference/critical-security-controls/v8-1/csc-13/csc-13-4/),
a widely-used mirror of CIS's own [Controls Navigator](https://www.cisecurity.org/controls/cis-controls-navigator))
 to be scoped to **IG2 and IG3 only — excluded from IG1**, CIS's own "essential cyber hygiene"
tier explicitly aimed at organizations with limited cybersecurity expertise and resources. This
is a concrete, sourced data point (not just this research's opinion) that a standards body
*itself* treats full network-segment traffic filtering and sensitivity-based storage segmentation
as a deliberate maturity uplift rather than a universal minimum — directly relevant to how far a
single-operator homelab should feel obligated to go.

### CISA's independent restatement of the same rationale

CISA's 2023 infographic ["Layering Network Security Through Segmentation"](https://www.cisa.gov/sites/default/files/2023-01/layering-network-security-segmentation_infographic_508_0.pdf)
cites NIST SP 800-53 SC-7 directly and frames the benefit in one sentence: "Segmented zones isolate and
protect high-value assets and data. Malicious traffic is easier to detect, prevent, and contain. [Threat
actors] must negotiate multiple firewalls ... to access the OT environment." It illustrates this with the
Purdue Enterprise Reference Architecture (PERA) — the ISA-95/ISA-99 OT/ICS layered model (Level
0 field devices → ... → Level 5 enterprise IT) — as the canonical "segmented" counter-example to a flat
network. PERA is OT-specific and not directly transferable to a home network, but it's frequently invoked in
homelab discussions as the "gold standard" of layered segmentation, so it's worth knowing as prior art rather
than a template to copy.

CISA's 2025 practice guide ["The Journey to Zero Trust: Microsegmentation in Zero Trust, Part One"](https://www.cisa.gov/sites/default/files/2025-07/ZT-Microsegmentation-Guidance-Part-One_508c.pdf)
is the most explicit primary source on *why*: "Microsegmentation ... significantly enhance[s] the security of
systems and data and helps reduce the blast area that a compromised resource can impact," by "reducing the
surface for lateral movement of adversaries that have breached networks" and "improving containment for
malware, malicious code, bugs, misconfigured systems and insider threats." It also states a maturity-model
view worth quoting directly (Table 4, "Network" pillar, from CISA's [Zero Trust Maturity Model v2.0](https://www.cisa.gov/sites/default/files/2023-04/zero_trust_maturity_model_v2_508.pdf)):

| Maturity | Network segmentation posture |
|---|---|
| Traditional | "large perimeter/macro segmentation with minimal restrictions on reachability within network segments" |
| Initial | "isolation of critical workloads, constraining connectivity to least function principles" |
| Advanced | "ingress/egress micro-perimeters and service-specific interconnections" |
| Optimal | "fully distributed ingress/egress micro-perimeters and extensive micro-segmentation" |

This scale is useful precisely because it's explicit that "Traditional" (a handful of macro-segments) and
"Initial" (macro-segments plus isolating your *critical* workloads specifically) are recognized, legitimate
rungs of the ladder — not just a lesser version of "Optimal." See the Recommendation section for why this
matters at single-operator scale.

### Storage specifically: what the vendor literature actually says

Two independent, primary vendor sources — one enterprise (VMware), one exactly matching this homelab's own
NAS software (TrueNAS/iX Systems) — recommend a dedicated VLAN for storage traffic (specifically iSCSI), and
both give **the same two reasons**, not a single "security" reason:

- **VMware**, ["Best Practices For Running VMware vSphere On iSCSI"](https://www.vmware.com/docs/best-practices-for-running-vmware-vsphere-on-iscsi):
  > "iSCSI should be considered a local-area technology, not a wide-area technology, because of latency
  > issues and security concerns. You should also separate iSCSI traffic from general traffic. Layer-2 VLANs
  > are a particularly good way to implement this separation. ... Best practice is to have a dedicated LAN
  > for iSCSI traffic and not share the network with other network traffic."
  >
  > "iSCSI storage traffic is transmitted in an unencrypted format across the LAN. Therefore, it is
  > considered best practice to use iSCSI on trusted networks only and to isolate the traffic on separate
  > physical switches or to leverage a private VLAN. **All iSCSI-array vendors agree that it is good practice
  > to isolate iSCSI traffic for security reasons.**"

- **TrueNAS / iX Systems**, ["Networking Recommendations"](https://www.truenas.com/docs/solutions/optimizations/networking/):
  > "iSCSI shares require specific networking considerations. iSCSI should be its own dedicated VLAN network
  > to isolate it from other network traffic. **This enhances security, reduces the risk of interference, and
  > provides easier Quality of Service (QoS) management.**"
  >
  > (General VLAN rationale, same doc): "VLANs provide logical segmentation, allowing different groups of
  > devices to be in separate broadcast domains ... Devices in one VLAN do not see the broadcast traffic of
  > devices in other VLANs, reducing broadcast domain size and improving network efficiency."

So, answering the user's framing directly:

- **Blast radius** — yes, this is part of the rationale, but it's the *generic* SC-7(21)/(29) "isolate by
  function" argument applied to storage, not something unique to storage. A compromised app host reaching
  the NAS's iSCSI/NFS *data plane* is exactly the SC-7(21) "limits unauthorized information flows among
  system components" concern; reaching the NAS's *management plane* (TrueNAS web UI, SSH) is really the
  SC-7(13) management-tooling-isolation concern, which is a stronger and more universally-applicable
  argument than the data-plane one.
- **Performance/broadcast-domain isolation** — yes, and this is actually the *more consistently cited*
  reason in both vendor docs above: oversubscription and retransmits on a shared broadcast domain degrade
  storage performance in a way that's more immediately noticeable than a security incident.
  Jumbo-frame/MTU tuning for storage traffic (common in enterprise iSCSI/NFS setups) is also usually done
  per-VLAN, which is a purely operational (non-security) reason to keep storage on its own L2 segment.
- **Protocol exposure (NFS/iSCSI/SMB attack surface)** — yes, and this is explicitly named by VMware:
  iSCSI is unencrypted by default, so anyone on the same broadcast domain can potentially observe or attempt
  to interfere with it (ARP spoofing, CHAP credential capture if used weakly, session hijacking). This is a
  real, protocol-specific reason distinct from generic "isolate everything" advice — but note it argues for
  isolating the *storage protocol's specific VLAN* (which carries iSCSI/NFS mount traffic), which is a
  narrower thing than "give the NAS its own VLAN" if the NAS also serves SMB shares to end-user devices,
  since those need to be reachable from the trusted/personal-devices tier by design.
- **Backup-network isolation** — not directly covered by the sources gathered here, but it's the same pattern
  as SC-7(29) "separate subnets to isolate functions": if backup traffic (e.g., replication to a second NAS,
  or an offsite target) is high-volume and time-sensitive, giving it its own segment is a performance
  decision more than a security one, unless the backup target itself is treated as a higher-trust asset that
  shouldn't be reachable from lower-trust tiers.
- **Is it overkill at single-operator scale?** The sources above don't answer this directly (they're
  aimed at enterprises with SANs, HA clusters, and dedicated storage teams) — see the Recommendation section
  for where this research lands on that question specifically.

## Question 2: Reference architecture for a whole home (personal + IoT + guest + homelab + NAS + management)

### The home-specific primary source: NIST SP 1800-15

The single most on-point primary source for "home network, not enterprise" is NIST's NCCoE practice guide
[SP 1800-15, "Securing Small-Business and Home IoT Devices"](https://csrc.nist.gov/pubs/sp/1800/15/final)
([full PDF](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1800-15.pdf)). It's built around
MUD (Manufacturer Usage Description), a specific IETF protocol for *automating* device-category-based
segmentation — that automation layer isn't relevant to a manual UniFi VLAN plan, but the guide's underlying
network model is directly relevant:

- It states plainly that small-business/home networks "are typically flat (unsegmented), predominantly
  connected via Wi-Fi-enabled devices, and managed by" non-specialist staff — i.e., NIST's own framing is
  that a flat home network is the *problem being solved*, not a baseline to defend.
- Its reference implementations (Builds 1–4) all converge on the same idea regardless of vendor: assign each
  device to a **"trust zone" based on its manufacturer/model/intended function**, then apply
  default-deny east-west policy between zones ("attempt to communicate from a device in category x to a
  device in category z; the router will not permit this communication to occur" — tested and expected
  behavior in the guide's exercises). CableLabs' "Micronets" build explicitly calls this pattern "a trust
  zone ... implemented as a network segment ... used to group devices together into trust domains that
  isolate devices based on their function and access policy."
- It maps this segmentation directly to NIST SP 800-53's `PR.AC-5`/`AC-4` controls ("Network integrity is
  protected (e.g., network segregation, network segmentation)"), i.e., it's presenting the same underlying
  enterprise control, just scaled to a home/small-business context.

### Ubiquiti's own built-in taxonomy (as installed on this exact hardware)

The prior research (see [`unifi-segmentation-research.md`](https://github.com/aaronkyriesenbach/catalyst/blob/research/unifi-segmentation-research/docs/research/unifi-segmentation-research.md))
already covers the mechanics of UniFi's Zone-Based Firewall in detail — not re-derived here — but it's worth
flagging that UniFi's **built-in zone list is itself a de facto reference taxonomy from the vendor whose
hardware this is**: External (untrusted/WAN), Internal (trusted LAN), Gateway (the router's own
management-plane traffic — DHCP/DNS/HTTPS/SSH to the console itself), VPN, Hotspot (guest-style, restricted
by default), and DMZ (for exposing self-hosted services). This maps cleanly onto the generic tier taxonomy
below: Gateway ≈ management/OOB, Internal ≈ trusted + infra (with intra-zone filtering available to further
split infra from personal devices), Hotspot ≈ guest, and a custom zone would typically be added for IoT.
(Source: Ubiquiti Help Center, ["Zero Trust" not applicable here — see prior research doc's Sources list for
the underlying Help Center article citations on Zone-Based Firewalls, already fetched and cited there.)

### Converged tier list (enterprise guidance + home-specific NIST guidance + vendor zone model)

Synthesizing NIST SP 1800-15's home-specific framing, the general SC-7 rationale, and CISA's segmentation
guidance, the tiers that recur across sources — and the *specific* thing each is isolated from and why —
are:

1. **Management / out-of-band (OOB).** The gateway's own admin plane (UniFi console UI/SSH), switch/AP
   management VLANs, hypervisor host BMC/iDRAC/iLO-equivalent and hypervisor web UI (Proxmox in this case).
   Isolated from *everything*, including the "trusted"/infra tier, because compromising this tier means an
   attacker can reconfigure the network itself, intercept/redirect any other tier's traffic, or take over
   the physical hosts underlying the whole platform. This is UniFi's own built-in "Gateway" zone concept
   generalized to include hypervisor management as well. NIST SC-7(13) (isolate security/management tooling
   via physically separate subnetworks) is the direct textual backing for this.
2. **Trusted / personal devices.** Family phones, laptops, personal computers. Isolated primarily from IoT
   and Guest (untrusted-by-design tiers), not usually from infra in most home guidance — see the dedicated
   discussion below on where homelab/cluster-infra sits relative to this tier.
3. **Server / infra (workloads).** Kubernetes nodes, general compute. In enterprise guidance this is
   typically *not* a separate concern from "trusted" — SC-7(21)/(29) argue for isolating it from other
   tiers by *function*, but the enterprise literature gathered here doesn't argue infra must be isolated
   from an org's own trusted user devices as a default position; that's a stricter, zero-trust-flavored
   choice some guidance recommends (see below).
4. **Storage.** Sometimes folded into "infra," sometimes its own tier — see Question 1's detailed answer.
   The stated rationale, when it is separated, is performance/broadcast-domain isolation plus
   protocol-specific exposure (iSCSI unencrypted-on-wire), not a categorically different security concern
   from "infra."
5. **IoT / smart-home devices.** Isolated from *everything* except what each device specifically needs
   (usually just outbound internet + maybe a hub), because these devices run vendor firmware the operator
   doesn't control, often have poor patch cadence, and are frequently cited (including by NIST SP 1800-15
   directly) as vectors for botnet recruitment (e.g., Mirai-style). Isolated from *personal devices*
   specifically because a compromised smart bulb/camera shouldn't have a path to a laptop or NAS.
6. **Guest.** Isolated from everything, full-stop, including IoT — because the *class of risk* is
   different: guest is untrusted **people** (visitors' own possibly-compromised devices) rather than
   trusted-but-unpatchable firmware. Guest devices also churn constantly (new MACs every visit), which
   argues against ever giving guest any elevated trust the way a known, fixed IoT device inventory might
   eventually earn.

### Is IoT typically separate from Guest, or combined?

**Typically separate**, and the reasoning in the sources gathered here is about *risk model*, not just
convention: NIST SP 1800-15's whole premise is that IoT devices need function-scoped, device-category-based
policies (each device only talks to what its MUD profile says it needs) — a much finer-grained and
longer-lived trust relationship than a transient guest network, which is usually just "internet only, no
LAN access, no exceptions, because we don't even know what device this is." UniFi's own built-in zone set
reflects this too: "Hotspot" (guest) is a distinct built-in zone from anything IoT-shaped, and Hotspot's
default posture (block-all to other Hotspot/DMZ zones) is stricter and less nuanced than what IoT devices
usually need (some IoT hubs need to reach specific cloud endpoints or a specific home-automation controller
on another VLAN, which guest traffic never needs). That said, at very small scale it's common — and not
unreasonable — to combine them if the operator is comfortable applying the stricter (guest-level) policy to
both, since a mistake here (a smart-home device with a real vulnerability, model list per NIST SP 1800-15's
threat framing) has real precedent as an attack vector.

### Where does homelab/cluster-infra sit relative to trusted personal devices?

The literature gathered here doesn't give a single universal answer — it splits into two defensible
positions, and which one applies depends on threat model, not on "correctness":

- **Same trust tier as personal devices (or immediately adjacent, filtered)**: nothing in the general SC-7
  guidance *requires* infra to be isolated from an organization's own trusted endpoints — SC-7(21)/(29) are
  about isolating by function generally, which is satisfied by infra having its own VLAN/subnet even if
  cross-tier policy is fairly permissive. UniFi's own Zone Matrix model supports this cleanly: multiple
  VLANs (trusted devices, infra, NAS) can all sit in the single "Internal" zone while still using
  **intra-zone filtering** to firewall between them individually — i.e., "same zone, different VLANs,
  explicit rules between them" is an explicitly supported, named pattern in UniFi's own model (see prior
  UniFi capability research), not a workaround.
- **Isolated from trusted personal devices too, on zero-trust grounds**: CISA's ZTMM (Table 4 above)
  frames the "Initial" maturity rung as "isolation of critical workloads" specifically, without carving out
  an exception for internally-trusted endpoints — the whole zero-trust premise (NIST SP 800-207) is that
  network location doesn't imply trust, so a personal laptop and a Kubernetes node are not automatically
  peers just because a human owns both. NIST SP 800-207 states this as one of its core tenets: "trust should
  not be automatically granted based on the device being on enterprise network infrastructure."

In practice, for a homelab specifically, the deciding factor tends to be **whether personal devices need
direct LAN access to workloads** (SSH to nodes, `kubectl`, NFS mounts for casual file access, printer/media
discovery via mDNS) versus **only need access through a gateway/reverse-proxy** (Traefik, a jump host). If
the former, infra effectively needs to be reachable from trusted devices anyway, so isolating it fully just
adds friction without removing the actual risk path (the human's own laptop is still the way in). If the
latter, infra can be isolated more strictly with a narrow, audited set of allowed flows.

### Where do management/out-of-band planes sit?

This is the one tier where the sources converge most strongly on "isolate it, including from infra, even in
otherwise-relaxed designs." Two independent lines of reasoning support this:

- **NIST SC-7(13)** ("Isolation of Security Tools, Mechanisms, and Support Components") explicitly calls for
  physically separate subnetworks for tooling/management components, reasoning that this "prevent[s]
  adversaries from discovering the analysis and forensics techniques employed" — generalizes directly to "an
  attacker who owns an app-tier host shouldn't be able to reach the hypervisor's management interface or the
  gateway's own admin plane," because those interfaces are how *everything else* gets reconfigured.
- **CISA's 2025 microsegmentation guidance** states this almost verbatim as a widely observed pattern (not
  a formal control, but a direct empirical observation from their own guidance): "Frequently a management
  network occupies a particularly trusted position and is ideally subject to stringent controls and
  monitoring."

The practical reasoning, independent of any citation, is straightforward and matches this homelab's own
components directly: Proxmox's web UI and the UniFi console's own admin plane are both "compromise once,
own everything" surfaces — a Proxmox web UI credential leak means every VM/container on every other VLAN is
reachable, and a UniFi console compromise means every firewall rule and VLAN definition itself is untrusted.
This is qualitatively different from compromising, say, one Kubernetes node (which a properly-isolated
cluster + NetworkPolicies should contain to that workload's blast radius), which is why stricter guidance
treats management/OOB as its own tier even when it's comfortable putting infra and personal devices in a
shared or lightly-filtered zone.

### Reference numbering schemes (inspiration only, not sourced to a standards body)

No standards-body source gathered here mandates a numbering convention. The convention frequently seen in
enterprise network-design material and homelab writeups alike — **VLAN ID mirrors the subnet's third
octet** (e.g., VLAN 10 → `10.x.10.0/24`, VLAN 20 → `10.x.20.0/24`, VLAN 30 → `10.x.30.0/24`) — is a widely
observed mnemonic in vendor example configurations (Cisco, Ubiquiti, and others routinely use this pattern in
their own worked examples), not a documented requirement from NIST, CISA, or IEEE 802.1Q. It's worth adopting
purely because it makes VLAN membership legible from an IP address at a glance during troubleshooting — the
task description's framing ("purely as inspiration, not a prescription") is the correct way to treat it; this
research did not surface a rigorous citation elevating it above "common practice."

## Question 3: Does running Kubernetes specifically (vs. a single server) change any of this?

The core Kubernetes networking requirement is deliberately minimal and L3-only. From the official
Kubernetes docs, ["Services, Load Balancing, and Networking" — "The Kubernetes network model"](https://kubernetes.io/docs/concepts/services-networking/):

> "The pod network ... ensures that (barring intentional network segmentation): All pods can communicate
> with all other pods, whether they are on the same node or on different nodes. Pods can communicate with
> each other directly, without the use of proxies or address translation (NAT)."

Nothing in this requirement mentions VLANs, L2 adjacency, or a specific subnet topology — it's a
**routability** requirement, satisfiable across any number of VLANs as long as IP routing exists between
node subnets (through the gateway/firewall, with appropriate allow rules). The one place this becomes
concrete is in how the specific CNI implements that routability:

- **k3s** (this cluster's likely CNI, per `AGENTS.md`'s mention of k3s directly) ships Flannel by default.
  Per [k3s's own docs, "Basic Network Options"](https://docs.k3s.io/networking/basic-network-options):
  - `--flannel-backend=vxlan` (**the default**): encapsulates pod traffic in VXLAN — this is an overlay, so
    it only needs ordinary IP reachability between node subnets. **Nodes can be split across VLANs/subnets
    with zero additional constraint** beyond normal firewall rules allowing the encapsulated traffic through.
  - `--flannel-backend=host-gw`: "Use IP routes to pod subnets via node IPs. **Requires direct layer 2
    connectivity between all nodes in the cluster.**" This is the one backend that would force cluster
    nodes onto the same VLAN/broadcast domain — a real constraint, but only if this non-default backend is
    chosen (usually for performance, since it avoids encapsulation overhead).
  - `--flannel-backend=wireguard-native`: encrypts inter-node pod traffic — same L3-only requirement as
    vxlan, plus transit encryption, which is a relevant option if cluster nodes end up on different
    VLANs/trust tiers and the operator wants pod-to-pod traffic protected in transit regardless.
- **Cilium** (a documented candidate elsewhere in this platform's design given the mesh decision in issue
  [#33](https://github.com/aaronkyriesenbach/catalyst/issues/33)) has the identical split. Per
  [Cilium's own docs, "Concepts: Routing"](https://docs.cilium.io/en/stable/network/concepts/routing/):
  - Encapsulation mode (VXLAN/Geneve, the default): "Encapsulation relies on normal node to node
    connectivity ... The topology of the underlying network is irrelevant as long as cluster nodes can reach
    each other using IP/UDP." No VLAN constraint.
  - Native-routing mode: requires either an external router that already knows how to reach all pod CIDRs,
    **or** all nodes sharing "a single L2 network" (if using `auto-direct-node-routes`), **or** a BGP daemon
    to distribute pod-CIDR routes across an L3-only topology. Same shape as Flannel's host-gw vs. vxlan
    split: direct/native routing imposes an L2 (same-VLAN) requirement unless BGP is added to remove it.

**Net effect on this platform's segmentation design**: as long as the eventual CNI choice stays on an
encapsulating backend (which is the default for both Flannel and Cilium), **cluster nodes can be split
across VLANs** (e.g., different physical racks, or a deliberate infra/management split) with no networking
penalty beyond normal firewall allow-rules for the encapsulation protocol's UDP port. Only a deliberate
choice of a non-default, non-encapsulated backend (`host-gw`, or Cilium native-routing without BGP) would
force all cluster nodes onto one VLAN — worth flagging explicitly if a future decision (e.g., chasing
lower-latency east-west pod traffic) considers that trade-off, since it would then constrain the IPAM/VLAN
plan in a way today's default config does not.

A second, purely-operational (not security) consideration worth flagging in the same breath: even when
nodes *can* be split across VLANs without breaking pod-to-pod reachability, Proxmox's own clustering layer
gives a reason to still prefer keeping them together. [Proxmox VE's "Cluster Manager" documentation](https://pve.proxmox.com/pve-docs/chapter-pvecm.html)
recommends "a dedicated physical NIC for the cluster traffic" for its Corosync protocol, because Corosync
needs consistent low latency and is sensitive to other traffic competing for bandwidth on the same link. The
same reasoning generalizes to CNI overlay heartbeat traffic and kube-apiserver/etcd chatter between
Kubernetes control-plane nodes: it benefits from staying on one low-latency segment together, not because
any CNI *requires* it, but because inter-VLAN routing adds latency/hops that control-plane consensus
protocols (etcd's Raft, Corosync) are more sensitive to than ordinary application traffic. This is a
reliability/performance argument for keeping cluster nodes on one shared VLAN, not a security argument for
isolating them — it doesn't change which *tier* the nodes belong to, only that splitting them across VLANs
purely for segmentation's sake has a latency cost worth weighing against the isolation benefit.

One secondary consideration, not a hard constraint: Kubernetes' own `NetworkPolicy` API (already decided as
in-scope per issue [#32](https://github.com/aaronkyriesenbach/catalyst/issues/32)) operates *inside* whatever
VLAN(s) the cluster's node/pod CIDRs live in — it's a complementary, finer-grained layer of segmentation
(pod-to-pod, namespace-to-namespace) that doesn't replace or require any particular VLAN topology, but it
does mean some of the "isolate workload X from workload Y" work this research discusses at the VLAN/zone
level can also be pushed down into NetworkPolicies once workloads are on the cluster, reducing pressure to
create a new VLAN for every workload-level trust distinction.

## Recommendation

This section is the requested opinionated synthesis — not a repetition of the sourced findings above.

**Adopt a small, function-based tier taxonomy, not a large or "fully micro-segmented" one.** Given
CISA's own maturity model (Table 4 above) explicitly recognizes "Initial" maturity — macro-segments plus
isolating your specifically *critical* workloads — as a legitimate, named rung distinct from "Optimal"
(extensive micro-segmentation), and given that "Optimal" assumes an automation/orchestration capability
(CI/CD-managed network policy, automated telemetry correlation) that a single operator cannot sustain
without it becoming the platform's biggest maintenance burden, the right-sized target here is closer to
"Initial": a handful of VLANs organized by function/trust, not a VLAN per workload or per device class.
Concretely, something like: **Management/OOB, Trusted (personal devices), Infra (cluster + NAS, together or
adjacent), IoT, Guest** — five tiers, not the eight-to-twelve some stricter enterprise or "microsegmentation"
guidance would suggest.

**The management/out-of-band tier is the one piece of "enterprise" advice worth taking un-diluted.**
This is the one place the reasoning holds regardless of operator count or adversary sophistication: it
protects against *accidents* (a fat-fingered firewall rule, a forgotten default credential, a workload that
turns out to have a container-escape CVE) causing *total* loss of control over the network and every
hypervisor host, not against a hypothetical APT. Proxmox host management interfaces and the UniFi console's
own admin plane should sit in a VLAN that ordinary cluster/app traffic cannot reach at all, with access from
only the operator's own trusted device(s) — this is cheap to do (one more VLAN, a couple of firewall rules)
and the downside of *not* doing it (one compromised container away from repaving the whole platform) is
disproportionate to the setup cost.

**Storage-as-its-own-VLAN is justified, but treat it as "give the storage *protocol* its own segment for
performance reasons, with a security bonus," not "the NAS is scary and must be walled off."** The
strongest, most consistently-cited rationale across both vendor sources gathered here (VMware, TrueNAS) is
performance/broadcast-domain isolation for iSCSI specifically, with unencrypted-protocol exposure as a real
but secondary security argument. This reading is reinforced by CIS Controls v8.1's own Implementation Group
scoping: Safeguard 3.12 ("Segment Data Processing and Storage Based on Sensitivity") and Safeguard 13.4
("Perform Traffic Filtering Between Network Segments") are both scoped to IG2/IG3, not IG1 — i.e., CIS's own
"essential cyber hygiene" baseline for resource-constrained organizations does not consider this class of
segmentation mandatory, which is a standards body independently agreeing this is an elective uplift rather
than a universal minimum. At single-operator homelab scale, with no adversary specifically targeting
this network and no compliance driver, treating "isolate the NAS's data-plane traffic (iSCSI/NFS mounts to
cluster nodes) onto its own VLAN" as **an infra/performance decision, not a hard security requirement**, is
the honest framing — it's good practice to do if it's roughly free (which it is, since UniFi supports it
natively and the NAS already needs a static assignment), but treating it as equivalent in importance to the
management-plane isolation above would be cargo-culting an enterprise SAN-team concern (protecting a shared
storage fabric serving many tenants/business units) onto a context where it doesn't really apply (one NAS,
one operator, one blast radius that's already bounded by not putting secrets/backups only on that NAS). The
NAS's *management plane* (TrueNAS web UI/SSH), on the other hand, deserves the same treatment as the
Management/OOB tier above, for the same accident-proofing reason — that part of the "storage" argument does
generalize regardless of scale.

**Don't isolate homelab/cluster-infra from personal/trusted devices by default; do it only if the actual
access pattern supports it.** The zero-trust framing ("network location shouldn't imply trust") is
philosophically appealing but is solving a problem (many users, many devices, adversaries actively probing a
large attack surface) this platform doesn't have. If the honest answer is "I `kubectl`/SSH into this cluster
from my personal laptop constantly," isolating infra from personal devices adds a bastion-host hop for no
real risk reduction, since the laptop is the actual access path either way. If most operator interaction with
the cluster goes through a browser hitting Traefik/ArgoCD (i.e., personal devices don't need raw LAN access
to nodes), then isolating infra costs nothing and is worth doing. This is a call the user is better placed to
make from their actual daily workflow than any citation here can settle.

**IoT and Guest: keep them separate.** The risk models genuinely differ (unpatchable vendor firmware you
trust by necessity, vs. transient untrusted devices/people), and UniFi's built-in zone model (Hotspot vs. a
custom/Internal-adjacent IoT zone) makes this essentially free to implement — there's no meaningful argument
for combining them at this scale beyond marginally less VLAN/DHCP-scope bookkeeping.

**Treat the octet-numbering convention as free hygiene, not a decision worth debating.** It costs nothing
and pays for itself the first time `192.168.53.x` shows up in a firewall log and it's obvious which tier it
belongs to. Adopt it and move on; it doesn't deserve further design time.

## Sources

Primary/first-party sources, fetched directly during this research:

- NIST SP 800-53 Rev 5, "Security and Privacy Controls for Information Systems and Organizations" — SC-7
  control family (Boundary Protection and enhancements .1, .11, .13, .20, .21, .22, .29):
  https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final ; control text extracted from the official OSCAL catalog:
  https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json
- NIST SP 800-207, "Zero Trust Architecture" (Section 3.1.2, "ZTA Using Micro Segmentation"; Section 2.1,
  tenets of zero trust): https://csrc.nist.gov/pubs/sp/800/207/final ;
  PDF: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf
- NIST SP 1800-15, "Securing Small-Business and Home IoT Devices" (NCCoE practice guide; home/small-business
  network framing, trust-zone/Micronets reference builds): https://csrc.nist.gov/pubs/sp/1800/15/final ;
  PDF: https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.1800-15.pdf
- CISA, "Layering Network Security Through Segmentation" (infographic, cites NIST SP 800-53 SC-7, Purdue
  Enterprise Reference Architecture):
  https://www.cisa.gov/sites/default/files/2023-01/layering-network-security-segmentation_infographic_508_0.pdf
- CISA, "The Journey to Zero Trust: Microsegmentation in Zero Trust, Part One" (2025):
  https://www.cisa.gov/sites/default/files/2025-07/ZT-Microsegmentation-Guidance-Part-One_508c.pdf
- CISA, "Zero Trust Maturity Model," Version 2.0 (April 2023), Table 4 "Network" pillar:
  https://www.cisa.gov/sites/default/files/2023-04/zero_trust_maturity_model_v2_508.pdf
- CIS Critical Security Controls v8.1 — Safeguard 13.4 ("Perform Traffic Filtering Between Network
  Segments," IG2/IG3) and Safeguard 3.12 ("Segment Data Processing and Storage Based on Sensitivity,"
  IG2/IG3): https://www.cisecurity.org/controls/cis-controls-navigator ; Implementation Group scoping
  cross-checked against https://csf.tools/reference/critical-security-controls/v8-1/csc-13/csc-13-4/ and
  https://csf.tools/reference/critical-security-controls/v8-1/csc-3/csc-3-12/
- Proxmox VE Documentation, "Cluster Manager" (dedicated-NIC recommendation for Corosync cluster traffic):
  https://pve.proxmox.com/pve-docs/chapter-pvecm.html
- VMware, "Best Practices For Running VMware vSphere On iSCSI" (dedicated-LAN/VLAN rationale for iSCSI,
  performance and security): https://www.vmware.com/docs/best-practices-for-running-vmware-vsphere-on-iscsi
- TrueNAS / iX Systems, "Networking Recommendations" (iSCSI dedicated-VLAN rationale; general VLAN/broadcast
  domain rationale): https://www.truenas.com/docs/solutions/optimizations/networking/
- Ubiquiti Help Center, "Using VLANs for Network Security and Performance" (general VLAN rationale:
  performance, security via L3 choke point, QoS/policy routing) — fetched via Wayback Machine snapshot
  (`help.ui.com` is Cloudflare-bot-gated for direct fetches from this environment; content verified as a
  mirror of the live article):
  https://help.ui.com/hc/en-us/articles/26136851868695-Using-VLANs-for-Network-Security-and-Performance
- Kubernetes documentation, "Services, Load Balancing, and Networking" — "The Kubernetes network model"
  section: https://kubernetes.io/docs/concepts/services-networking/
- k3s documentation, "Basic Network Options" (Flannel backend options: vxlan default, host-gw's explicit
  "Requires direct layer 2 connectivity" requirement, wireguard-native):
  https://docs.k3s.io/networking/basic-network-options
- Cilium documentation, "Concepts: Routing" (encapsulation vs. native-routing requirements, L2 vs. BGP
  distribution of pod-CIDR routes): https://docs.cilium.io/en/stable/network/concepts/routing/
- Prior repo research (skimmed for context, not re-derived):
  [`docs/research/unifi-segmentation-research.md`](https://github.com/aaronkyriesenbach/catalyst/blob/research/unifi-segmentation-research/docs/research/unifi-segmentation-research.md)
  on branch `research/unifi-segmentation-research` — UniFi Zone-Based Firewall mechanics, built-in zone list,
  intra-zone filtering capability.

## What could not be verified / sources attempted but blocked

- **r/homelab's own wiki and top community VLAN writeups** were explicitly requested as a source category but
  were **not reachable** from this environment: `reddit.com` and `old.reddit.com` both return a hard
  bot-detection block (HTTP 403, "whoa there, pardner!") on direct fetch, and even a Wayback Machine snapshot
  of the same page redirects into Reddit's live bot-verification challenge rather than serving archived
  content. No community-writeup content was fetched as a substitute for a specific "r/homelab consensus"
  citation; NIST SP 1800-15 was used instead as the closest available *home-specific* (rather than generic
  enterprise) primary source, since it independently arrives at the same function-based trust-zone model.
- A specific, well-known independent homelab VLAN writeup (Techno Tim's `docs.technotim.live` VLAN post) was
  sought but the specific URL for that post could not be located — the site's `/posts/vlan-setup-unifi/` path
  no longer resolves to that content (redirects to the site's current homepage), and a targeted search did
  not surface a working replacement URL in the time available. This is flagged rather than silently dropped,
  in case the user wants to point at the current correct URL for a follow-up read.
- A SANS Institute reading-room paper specifically on network segmentation was sought (the user's question
  named SANS explicitly) but SANS's white-paper search endpoints either timed out or returned client-rendered
  pages with no server-side text in the time available for this research pass. NIST/CISA material was judged
  sufficient to cover the same ground (SANS papers on this topic generally cite the same NIST SC-7 control
  family), but a dedicated SANS citation was not obtained.
