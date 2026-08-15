# Research: Network Segmentation / IPAM Scheme for a Combined Home + Homelab Network

Ticket: [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5) ("Decide the network
segmentation / IPAM scheme"), part of the "Homelab platform rearchitecture" wayfinder map
([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

Related prior research (hardware/software capability, not tier design):
[docs/research/unifi-segmentation-research.md](https://github.com/aaronkyriesenbach/catalyst/blob/research/unifi-segmentation-research/docs/research/unifi-segmentation-research.md)
(issue [#4](https://github.com/aaronkyriesenbach/catalyst/issues/4)) confirmed the UCG-Max runs
current UniFi OS with a Zone-Based Firewall (UniFi Network 9.0+) and full VLAN support — this
document assumes that capability and focuses on *what tiers/zones to actually build*.

## TL;DR

- **The "enterprise standard" is a real, named practice** — CISA, NIST, and CIS all publish
  segmentation guidance built on the same core idea: group assets by trust/sensitivity, put
  policy-enforced boundaries between groups, and treat "isolate the management/control plane"
  as the single highest-priority boundary because its compromise is total compromise of
  everything behind it. This is NIST SP 800-53's **SC-7 (Boundary Protection)** and its
  enhancement **SC-7(21) Isolation of System Components**, echoed by CIS Controls'
  **Safeguard 13.4 (Traffic Filtering Between Network Segments)**.
- **Storage-specific isolation is real vendor guidance, not cargo-culted enterprise-only
  practice** — TrueNAS's own "Networking Recommendations" doc explicitly recommends putting the
  NAS (and especially iSCSI) on its own VLAN/subnet, for three *independent* reasons: (1) reduced
  attack surface / blast radius (separating the NAS from general traffic), (2) broadcast-domain
  and bandwidth isolation (a busy general LAN shouldn't be able to starve storage throughput),
  and (3) QoS/traffic-prioritization simplicity (easier to guarantee storage gets bandwidth when
  it's cleanly identifiable by subnet). None of this is about compliance theater — it's
  first-party guidance for exactly this kind of single-NAS home/small-office deployment.
- **However, CIS's own Implementation Group (IG) tiering shows this is explicitly *not* baseline
  practice for small/low-resource operations.** Safeguard 3.12 ("Segment Data Processing and
  Storage Based on Sensitivity") and Safeguard 13.4 ("Traffic Filtering Between Network
  Segments") are both **IG2/IG3 only** — excluded from IG1, the "essential cyber hygiene" tier
  CIS defines for organizations with limited security resources and expertise (which, functionally,
  describes a single-operator home network). This is a real, sourced data point supporting the
  view that full segmentation rigor is a *deliberate uplift*, not something you're delinquent for
  skipping at home.
- **Common home+homelab trust-tier taxonomies converge on 5–7 tiers**: Management/OOB, Trusted
  (personal/family), IoT, Guest, Servers/Infra (homelab), Storage (sometimes folded into
  Servers/Infra), and occasionally a DMZ for anything internet-facing. IoT and Guest are
  **typically split**, not combined, because they have different threat models (IoT devices are
  *yours* but often unpatched/vulnerable and phone-home to arbitrary vendor clouds; Guest is
  fully untrusted, ephemeral, and expected to want nothing but Internet egress).
- **A homelab/cluster-infra tier is conventionally treated as a separate trust tier from personal
  devices**, not folded into "trusted" — same rationale as storage: personal devices are
  operated by a human who patches/avoids malware casually, while a homelab runs self-hosted,
  internet-adjacent services (reverse proxies, containers, sometimes exposed to the WAN) that are
  a meaningfully larger attack surface. Stricter guidance goes further and treats the
  **hypervisor/gateway management plane as its own tier isolated even from infra/cluster
  traffic**, because compromising Proxmox or the UCG-Max itself is a total compromise of
  everything virtualized or routed through it (this is precisely what SC-7(21) is for).
- **Kubernetes doesn't impose a hard VLAN constraint** — the Kubernetes network model only
  requires non-overlapping IP ranges across Pods, Services, and Nodes, and that pods can reach
  each other without NAT; the CNI implements that model over whatever L2/L3 substrate the nodes
  sit on (overlay/VXLAN, routed, or otherwise). The one *practical* constraint that does exist:
  node-to-node cluster traffic (CNI overlay, kube-apiserver, etcd) benefits from being on a flat,
  low-latency segment the way Proxmox's own corosync guidance recommends a dedicated NIC for
  cluster traffic — this is a performance/reliability recommendation, not a security-driven
  segmentation requirement, and doesn't change the *trust*-tier argument at all.
- **Octet-per-tier VLAN numbering (VLAN 10 = mgmt, 20 = servers, 30 = trusted, 40 = IoT, 50 =
  guest, etc.) is common informal convention**, not a standard — noted below purely as
  inspiration, not because any of the cited standards bodies prescribe it.

---

## 1. What is the "enterprise standard," and what does it actually say?

### 1.1 NIST SP 800-53 Rev. 5 — SC-7 (Boundary Protection)

Source: NIST, *Security and Privacy Controls for Information Systems and Organizations*, SP
800-53 Rev. 5 (`https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf`).

- **SC-7 base control** requires organizations to: monitor and control communications at the
  external boundary of the system and at *key internal boundaries within the system*; implement
  subnetworks for publicly accessible components that are physically or logically separated from
  internal organizational networks; and connect to external networks only through managed
  interfaces (gateways, routers, firewalls) arranged per a security architecture. The control's
  discussion explicitly names physically/logically separated subnetworks as the origin of the
  term **DMZ**.
- **SC-7(21) — Isolation of System Components**: "Employ boundary protection mechanisms to
  isolate [system components] supporting [missions and/or business functions]." The stated
  rationale is that isolating components by mission/function *limits unauthorized information
  flows among system components* and lets you apply *greater levels of protection for selected
  components*, providing "enhanced protection that limits the potential harm from hostile cyber
  attacks and errors." This is the direct textual source for "compromise of one function
  shouldn't cascade into another" — it is a generic mission/function-boundary argument, not
  storage-specific, but storage, compute, and management-plane are each naturally distinct
  "functions" under this framing.
- This is the control the CISA infographic below cites as its authority for segmentation.

### 1.2 CISA — "Layering Network Security Through Segmentation" (2023 infographic)

Source: CISA,
`https://www.cisa.gov/sites/default/files/2023-01/layering-network-security-segmentation_infographic_508_0.pdf`.

- Framed around IT/OT segmentation (the Purdue Enterprise Reference Architecture), but the
  general argument generalizes directly to home+homelab: an unsegmented network means "OT
  [read: any lower-trust/higher-value] networks are exposed to vulnerabilities in connected IT
  networks," it's "easier for threat actors to move laterally after breaching the [outer]
  network," and "detecting threat actors is more difficult due to increased volume of network
  traffic" on a flat network.
- Stated benefits of segmenting: "Segmented zones isolate and protect high-value assets and
  data," "malicious traffic is easier to detect, prevent, and contain," and an attacker "must
  negotiate multiple firewalls and other protocols to access the [protected] environment."
  Recommendation: "Establish a segmented high security zone for high value assets and/or [core]
  systems components," with a DMZ for anything that must be reachable but isn't itself high-value.
- This is the closest primary-source articulation of **why a NAS's management plane/shares would
  be treated as a "high value asset"**: it's not about the storage protocol per se, it's that
  the NAS holds all your data and (per iXsystems below) is often reachable by protocols with weak
  or no per-request authentication — so it fits CISA's "high value asset deserving its own zone"
  category on its merits, independent of any storage-specific technical rationale.

### 1.3 NIST SP 800-207 — Zero Trust Architecture

Source: NIST, `https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf`.

- Section 3.1.2, "ZTA Using Micro-Segmentation," is one of three canonical approaches NIST
  documents for implementing zero trust — grouping resources into small enforcement zones
  ("enclaves") with policy enforcement at each boundary, as opposed to identity-based or
  software-defined-perimeter approaches. This is the standards-body articulation of
  "microsegmentation" as a named, credible technique (relevant since it's the term often invoked,
  sometimes loosely, in homelab discussions) — but 800-207 is explicit that ZTA is a *spectrum of
  approaches* and micro-segmentation is one tool among several, not a mandate to segment every
  functional group.

### 1.4 CIS Critical Security Controls v8.1

Source: CIS, `https://www.cisecurity.org/controls/network-infrastructure-management`,
`https://www.cisecurity.org/controls/network-monitoring-and-defense`, and the CIS Controls
Navigator (`https://www.cisecurity.org/controls/cis-controls-navigator`).

- **Control 12 (Network Infrastructure Management)**: "Establish, implement, and actively manage
  (track, report, correct) network devices, in order to prevent attackers from exploiting
  vulnerable network services and access points."
- **Control 13 (Network Monitoring and Defense)**: "Operate processes and tooling to establish
  and maintain comprehensive network monitoring and defense against security threats across the
  enterprise's network infrastructure and user base."
- **Safeguard 13.4 — "Perform Traffic Filtering Between Network Segments"**: "Perform traffic
  filtering between network segments, where appropriate." **Implementation Group: IG2/IG3 only**
  — not part of IG1.
- **Safeguard 3.12 — "Segment Data Processing and Storage Based on Sensitivity"**: "Segment data
  processing and storage based on the sensitivity of the data. Do not process sensitive data on
  enterprise assets intended for lower sensitivity data." **Implementation Group: IG2/IG3 only**
  — not part of IG1.
- **Why the IG tiering matters for this decision**: CIS's Implementation Groups are explicitly a
  resource/maturity ladder — IG1 is CIS's own definition of the *minimum viable baseline* for
  organizations with limited cybersecurity expertise and resources (their own docs describe IG1
  orgs as small/resource-constrained). Both of the safeguards most directly analogous to "put
  storage on its own segment" and "filter between segments" are things CIS **itself does not
  consider baseline hygiene** — they're an intentional step up, reserved for organizations with
  more resources/formal risk management. This is the strongest sourced evidence for "storage
  segmentation is a deliberate uplift, not a universal minimum," and directly answers the "is
  this overkill at single-operator scale" half of the question: by the standard-setter's *own*
  tiering, yes, at pure CIS-IG1 scale it would be optional, not overkill *per se*, but genuinely
  elective.

---

## 2. Why would storage specifically get its own VLAN/subnet? (direct vendor rationale)

Source: TrueNAS/iXsystems Documentation Hub, "Optimizations → Networking" ("Networking
Recommendations"), `https://www.truenas.com/docs/solutions/optimizations/networking/`.

This is the most concrete, first-party answer to the "why does storage deserve isolation"
question, and it gives three genuinely distinct rationales rather than one:

1. **Layer 2 (VLAN) isolation — broadcast-domain/performance, not primarily security.** "Use
   VLANs... to segment your network and isolate traffic... Devices in one VLAN do not see the
   broadcast traffic of devices in other VLANs, reducing broadcast domain size and improving
   network efficiency." This is the same broadcast-domain argument Ubiquiti gives for VLANs in
   general (§3 below) — it's not storage-specific, storage just benefits from it like everything
   else on a busy network.
2. **Layer 3 (subnet) isolation — explicitly security- and performance-motivated, and named as
   *the* pattern for storage specifically**: "Use network layer (subnet) isolation to separate
   **storage traffic** from other network traffic to avoid congestion... By placing the TrueNAS
   system on a separate subnet, you can isolate it from general... traffic. This helps in
   reducing the attack surface and provides an additional layer of security." It further calls
   out that a dedicated storage subnet gives "more granular control over bandwidth allocation"
   and prevents "heavy [general] traffic" from degrading NAS performance for
   "critical or time-sensitive operations," and that it "provides a scalable solution" as the
   network grows.
3. **iSCSI specifically gets a stronger, protocol-specific recommendation**: "iSCSI should be its
   own dedicated VLAN network to isolate it from other network traffic. This enhances security,
   reduces the risk of interference, and provides easier Quality of Service (QoS) management."
   iSCSI is block storage presented as a raw SCSI transport over TCP/IP with comparatively weak
   built-in access control (CHAP auth is optional/commonly skipped in homelab setups, and there is
   no per-share ACL model the way SMB/NFS have) — so "anyone on this VLAN can potentially mount
   this LUN" is a materially bigger blast-radius concern than for file-level shares.

**Direct answer to "is this about blast radius, performance, protocol exposure, or overkill":**
per this first-party source, it's explicitly **both blast-radius/attack-surface reduction *and*
performance/broadcast-domain isolation**, with iSCSI carrying an extra protocol-exposure argument
on top. It is **not** framed by the vendor as a backup-network-isolation pattern specifically
(that's a related but distinct concern — see NIST SC-7(21) above, which is the general "isolate a
function so its compromise doesn't cascade" argument, applicable to backup networks too, but
TrueNAS's own doc doesn't single out backups). Given CIS's own IG-tiering (§1.4) treats
data-sensitivity segmentation as an elective uplift rather than baseline hygiene, the honest
synthesis is: **the rationale is real and vendor-documented, not fabricated enterprise-cargo-cult,
but it is also not something you're negligent for skipping at single-NAS/single-operator scale —
it's a genuine trade a homelabber can consciously choose to make or not.**

---

## 3. Why VLANs/zones at all — the general (non-storage) rationale

Source: Ubiquiti Help Center, "Using VLANs for Network Security and Performance"
(`https://help.ui.com/hc/en-us/articles/26136851868695`, retrieved via Wayback Machine snapshot
2025-09-07 due to a live-site bot challenge).

- **Performance**: "VLANs help manage broadcast traffic, such as DHCP requests or mDNS, which can
  overwhelm large networks with thousands of clients. By segmenting networks, you can ensure
  smoother operations and avoid network congestion." (Same broadcast-domain argument as TrueNAS's
  doc — this is the generic "why VLAN at all" answer independent of security.)
- **Security**: "VLANs operate at Layer 2, meaning that communication between multiple VLANs
  requires Layer 3 routing at the gateway. This provides an opportunity to implement robust
  firewall rules and isolation policies." Ubiquiti's own worked example is exactly the
  guest-isolation case: "Isolate a public guest WiFi from all other VLANs on the network."
- **QoS/Policy-Based Routing**: grouping "by functionality" (their examples: "Guest Network,"
  "Employees," "VoIP") lets you apply differentiated QoS/routing per group — this is the same
  "group by function, then apply policy per group" logic that underlies trust-tier taxonomies in
  general, just applied to performance instead of security.

This confirms the "enterprise standard" pattern is fundamentally: **VLAN = broadcast domain +
policy-enforcement boundary at Layer 3.** Everything else (which tiers you choose, how many, what
you call them) is a judgment call about which groups of devices have different-enough
trust/function/performance needs to be worth a boundary.

---

## 4. Reference trust-tier taxonomy for a combined home + homelab network

Synthesizing §§1–3 against the specific device inventory in the question (family/personal
devices, IoT, guest WiFi, homelab/cluster-infra, NAS, Proxmox hosts + gateway admin plane), the
tiers that recur across the cited sources are:

| Tier | Isolated *from* | Why (sourced rationale) |
|---|---|---|
| **Management / Out-of-Band** (UCG-Max admin plane, Proxmox host management interfaces, IPMI/BMC if present) | Everything else, including infra/cluster traffic | SC-7(21): compromising the thing that *routes* or *virtualizes* everything else is total compromise. TrueNAS's own docs separately recommend running "the management UI and IPMI... on one subnet and data on another" (§2, Layer 3 Isolation) — i.e. iXsystems applies this same principle to their own admin plane, not just to "storage data." |
| **Trusted / Personal** (phones, laptops, family PCs) | IoT, Guest, Infra | The CISA "high-value asset" framing works in reverse here too — this is where a human directly authenticates to sensitive accounts (banking, email, work), so it's the tier you protect *from* the other, higher-risk tiers, not just a tier you protect other things from. |
| **IoT** | Trusted, Guest, Infra | NIST's SP 1800-15 (MUD project, `https://csrc.nist.gov/pubs/sp/1800/15/final`) frames the IoT threat model explicitly: these are devices whose "network communications" should be restricted to only what "the device's manufacturer intended," specifically because unconstrained IoT devices are vulnerable to "botnets and other network-based threats" and can cause harm "from exploited IoT devices" if not contained. This is a different threat model from Guest: IoT devices are *yours* (you may want to reach them from Trusted, e.g. controlling a smart-home hub) but are comparatively unpatched/vulnerable and often phone home to arbitrary vendor clouds. |
| **Guest** | Everything | Fully untrusted, ephemeral, zero expectation of needing to reach anything except the Internet. Ubiquiti's own built-in "Hotspot" zone in the Zone-Based Firewall defaults to Block-All for Hotspot↔Hotspot and heavily restricts Hotspot↔Internal/External by default (see prior research doc, §"Firewall & segmentation model"), i.e. the vendor's own default posture treats Guest as the most locked-down tier by default. |
| **Servers / Infra** (homelab compute — your Kubernetes nodes) | Trusted/personal devices, IoT | This is the "different mission/function" argument from SC-7(21): a homelab runs self-hosted, sometimes internet-adjacent services (reverse proxies, exposed apps) that materially increase attack surface versus a phone or laptop used for browsing — CISA's segmentation argument ("limits how far an attacker who breaches one zone can move") applies to *this* boundary as much as any other. |
| **Storage** (optional; either its own tier or folded into Servers/Infra) | Everything except the hosts that need to consume it | Per §2: attack-surface reduction for the NAS's management plane and shares, broadcast-domain/bandwidth isolation, and (for iSCSI specifically) protocol-exposure reduction — genuine but, per CIS's own IG-tiering, an elective uplift rather than a baseline requirement at this scale. |
| **DMZ** (optional; anything actually exposed to the WAN) | Everything internal | CISA/NIST SC-7's literal definition of a DMZ: a subnet "physically or logically separated from internal organizational networks" specifically for things that must be reachable from outside. Only relevant here if something is directly WAN-exposed rather than reached via reverse tunnel/VPN. |

### 4.1 Is storage commonly its own tier?

Yes, when a taxonomy goes beyond the minimum — but it's explicitly one of the "extra credit" tiers
rather than a tier every reference always includes. The clearest and most authoritative version
of "storage deserves its own boundary" is TrueNAS's own vendor guidance (§2), which is unambiguous
and unconditional for iSCSI, and directional-but-real for general NAS traffic ("reduce the attack
surface," "isolate from general traffic"). CIS formalizes the general "data-based segmentation"
version of this as Safeguard 3.12, but gates it to IG2/IG3 — i.e., the standards body's own
maturity model treats it as beyond baseline. **Folding storage into the same tier as
Servers/Infra (rather than its own VLAN) is a legitimate, sourced-consistent choice at this
scale**, as long as the NAS's *management* interface (not just data plane) gets equivalent
protection to the other management-plane assets in the Management/OOB tier — that split (data
plane vs. management plane) matters more than whether storage data traffic gets a dedicated VLAN.

### 4.2 IoT vs. Guest — same tier or separate?

Separate, per every source that discusses both. They have different trust postures even though
both are "less trusted than personal devices": Guest is *transient and foreign* (a visitor's
phone, with zero expectation it needs to reach anything you own); IoT is *persistent and yours*
(a smart bulb or camera you may legitimately want to control from a phone on the Trusted tier, but
whose firmware you don't fully control and which may have a much longer unpatched-vulnerability
window). NIST's MUD-based guidance (SP 1800-15) is specifically about containing *IoT*, not guest
devices, because the failure mode (a compromised, botnet-recruited device sitting permanently on
your network) is different from the Guest failure mode (an untrusted-but-temporary device you
never wanted to trust in the first place).

### 4.3 Where does homelab/cluster-infra sit relative to trusted personal devices?

Conventionally its **own tier, not folded into Trusted**, for the SC-7(21) "different
mission/function" reason above: a homelab is a materially larger and differently-shaped attack
surface (self-hosted web apps, often internet-adjacent, frequently running third-party container
images) than a family laptop. The CISA argument that attackers "must negotiate multiple firewalls"
to reach high-value assets after breaching one zone applies symmetrically here: if a container
escape or app vulnerability compromises a homelab node, you don't want that host to have
unfiltered access to family devices (and vice versa — if a family device gets phished, you don't
want it able to reach the homelab's management surfaces).

### 4.4 Where does the management/out-of-band plane sit?

The strictest, best-sourced answer: **its own tier, isolated even from Infra/Servers**, not merged
with the cluster network. This is the direct, textual application of SC-7(21) — the Proxmox
hypervisor hosts and the UCG-Max's own admin plane are exactly the kind of "system component
supporting a distinct mission/business function" that SC-7(21) says to isolate, and they are
categorically more sensitive than the workloads they host: compromising a Kubernetes pod is bad;
compromising the Proxmox host under it or the gateway routing everything is total compromise of
everything else, including the isolation boundaries you built for every other tier. TrueNAS's own
doc echoes this exact idea one level down the stack ("run the management UI and IPMI... on one
subnet and data on another," §2) — i.e., "separate management plane from data plane" is a pattern
iXsystems applies to its own product, not something invented for this research.

### 4.5 Numbering conventions (inspiration only, not prescriptive)

None of the cited standards (NIST, CISA, CIS) prescribe a numbering scheme — VLAN IDs and octets
are purely a local addressing choice. That said, an "octet-per-tier" convention (e.g., VLAN
10/`.10.0/24` = Management, 20/`.20.0/24` = Servers/Infra, 30/`.30.0/24` = Trusted, 40/`.40.0/24`
= IoT, 50/`.50.0/24` = Guest, 90/`.90.0/24` = DMZ) is extremely common informally across
enterprise network-engineering training material and homelab writeups, mostly because it's
mnemonic (VLAN ID mirrors the third octet) and leaves gaps for future tiers. It is cited here only
as widely-observed prior art worth considering for readability, not as anything backed by a
standards body — the actual security properties come entirely from the zone/firewall policy, not
the numbers chosen.

---

## 5. Does running Kubernetes (vs. a single homelab server) change any of this?

Source: Kubernetes documentation, "Cluster Networking"
(`https://kubernetes.io/docs/concepts/cluster-administration/networking/`); Proxmox VE
documentation, "Cluster Manager" (`https://pve.proxmox.com/pve-docs/chapter-pvecm.html`).

- **No hard VLAN constraint from the CNI.** Kubernetes' networking model has exactly one hard
  requirement relevant here: "Kubernetes clusters require [operators] to allocate non-overlapping
  IP addresses for Pods, Services, and Nodes, from a range of available addresses" — i.e., pick
  Pod CIDR / Service CIDR / Node subnet so none of them overlap each other. The network plugin
  (CNI) is what actually implements pod-to-pod reachability "without NAT," but *how* it does that
  (VXLAN overlay, BGP-routed, host-network, etc.) is independent of which VLAN the underlying
  nodes sit on — nodes just need L3 reachability to each other, which any inter-VLAN-routed
  gateway/zone policy can provide as long as the necessary CNI ports are allowed through the
  zone policy.
- **The one practical (not security) constraint**: cluster **control-plane/overlay traffic
  benefits from a flat, low-latency segment**, the same way Proxmox explicitly recommends "a
  dedicated physical NIC for cluster traffic" for its own Corosync protocol, because Corosync
  "needs consistent low latency but not a lot of bandwidth" and "other services [competing for]
  bandwidth... would increase the latency." The same logic applies to CNI overlay/heartbeat
  traffic and kube-apiserver/etcd communication between nodes — it wants to live on one segment
  with predictable latency, not be routed through multiple hops of zone-policy inspection on
  every packet. This is a **performance/reliability** argument for keeping cluster nodes on one
  VLAN together, not a security argument for isolating them from anything in particular — it
  doesn't change which *tier* the nodes belong to, only that they should stay on the *same*
  subnet as each other rather than being split across VLANs individually.
- **Net effect on the tier taxonomy in §4**: none. Kubernetes nodes still belong in
  Servers/Infra for the same reason a single homelab server would; the cluster's internal
  requirements (non-overlapping CIDRs, one flat low-latency segment for node-to-node traffic) are
  satisfied entirely *within* that one VLAN and don't require carving out additional VLANs per
  node or per workload. (Anything more granular than that — e.g., per-namespace network
  policies — is a Kubernetes `NetworkPolicy`/CNI-level concern, layered *on top of* whichever
  VLAN the cluster sits in, not a substitute for or an alternative to VLAN-level segmentation.)

---

## 6. Recommendation (opinionated, for a single-operator home + homelab)

Given the explicit ask for an opinionated stance rather than a menu:

1. **Do build a real trust-tier taxonomy — this part of "enterprise standard" is genuinely
   justified, not cargo culted.** The core argument (SC-7(21): isolate by mission/function so
   compromise of one thing doesn't cascade to everything) doesn't require enterprise scale to be
   true — it's just as true when the "enterprise" is one person with a homelab, a family, and
   guests. Recommended tiers: **Management/OOB, Trusted/Personal, IoT, Guest, Servers/Infra**
   (5 tiers minimum). This matches what every cited source converges on and each tier answers a
   distinct, sourced "isolated from what, why" question in §4.
2. **Do isolate the Management/OOB plane above everything else, including the homelab's own
   Servers/Infra tier.** This is the highest-confidence, best-sourced recommendation in this
   document (SC-7(21), plus TrueNAS's own "separate the admin UI/IPMI from data" pattern). Proxmox
   host management interfaces and the UCG-Max's own admin plane should not be reachable from the
   Kubernetes-node VLAN by default — the blast radius of a compromised pod reaching the
   hypervisor under it is categorically worse than any other lateral-movement path in this
   network.
3. **Don't feel obligated to give storage its own VLAN at this scale — treat it as a legitimate,
   deliberate choice either way, not a compliance requirement.** The vendor rationale (§2) is real
   and worth taking seriously for **iSCSI specifically** if it's ever used (weak built-in access
   control makes "who can reach this VLAN" load-bearing for security, not just tidiness). For
   general NFS/SMB shares, CIS's own IG-tiering (§1.4) puts this kind of data-sensitivity
   segmentation in the "beyond baseline" bucket for exactly this kind of operation — a single
   NAS, one operator, no compliance driver, no adversary specifically targeting this network.
   **Reasonable choice**: keep the NAS's *data* interfaces on the same Servers/Infra VLAN as the
   Kubernetes nodes that consume it (simpler, one less VLAN to manage, no protocol-exposure
   concern for NFS/SMB), but put the NAS's *management* interface (TrueNAS web UI, SSH) behind the
   same Management/OOB boundary as Proxmox/gateway admin — because the "admin plane vs. data
   plane" split (§4.4) is the part of storage isolation that's unambiguously justified regardless
   of scale, while "isolate the data plane too" is the part that's genuinely optional. If iSCSI
   gets added later, give *that* its own VLAN at that point — it's a narrower, better-justified
   ask than "storage" as a blanket category.
4. **Keep IoT and Guest separate** — cheap to do, clearly different threat models (§4.2), and
   UniFi's built-in Hotspot zone already gives Guest a locked-down default posture for free.
5. **Kubernetes nodes stay in Servers/Infra as a single flat VLAN together** — no per-node or
   per-workload VLAN splitting is warranted; the CNI's only hard requirement is non-overlapping
   CIDRs (§5), and cluster-internal traffic wants low latency more than it wants isolation from
   itself.
6. **Treat the numbering scheme as bikeshedding** — pick whatever's mnemonic (an octet-per-tier
   convention is fine, §4.5) and move on; none of the actual security properties come from the
   numbers.

**Bottom line**: the enterprise segmentation model generalizes to a home+homelab cleanly for the
*mission/function isolation* argument (Management/OOB, Trusted, IoT, Guest, Infra), and that part
should be adopted in full. The *storage-specific* piece of the enterprise model is real
vendor-documented guidance, not overkill by construction — but it is also, by the standard-setter's
own admission (CIS IG1 vs IG2/IG3), an optional uplift rather than a baseline requirement at
single-operator scale, so it's fair to defer it (fold storage traffic into Infra, isolate only its
admin plane) until/unless a concrete need (iSCSI, multi-tenant, compliance) shows up.

---

## Sources

- NIST SP 800-53 Rev. 5, *Security and Privacy Controls for Information Systems and
  Organizations* — SC-7 (Boundary Protection) and SC-7(21) (Isolation of System Components).
  `https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf`
- NIST SP 800-207, *Zero Trust Architecture* — §3.1.2, "ZTA Using Micro-Segmentation."
  `https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf`
- NIST SP 1800-15, *Securing Small-Business and Home IoT Devices* (NCCoE Practice Guide, MUD).
  `https://csrc.nist.gov/pubs/sp/1800/15/final`
- CISA, "Layering Network Security Through Segmentation" (infographic, 2023).
  `https://www.cisa.gov/sites/default/files/2023-01/layering-network-security-segmentation_infographic_508_0.pdf`
- CIS Critical Security Controls v8.1 — Control 12 (Network Infrastructure Management), Control
  13 (Network Monitoring and Defense), Safeguard 13.4 (Traffic Filtering Between Network
  Segments, IG2/IG3), Safeguard 3.12 (Segment Data Processing and Storage Based on Sensitivity,
  IG2/IG3). `https://www.cisecurity.org/controls/network-infrastructure-management`,
  `https://www.cisecurity.org/controls/network-monitoring-and-defense`,
  `https://www.cisecurity.org/controls/cis-controls-navigator`
- TrueNAS/iXsystems Documentation Hub, "Optimizations → Networking" ("Networking
  Recommendations"). `https://www.truenas.com/docs/solutions/optimizations/networking/`
- Ubiquiti Help Center, "Using VLANs for Network Security and Performance."
  `https://help.ui.com/hc/en-us/articles/26136851868695-Using-VLANs-for-Network-Security-and-Performance`
  (retrieved via Wayback Machine snapshot dated 2025-09-07 due to a live-site bot challenge)
- Kubernetes documentation, "Cluster Networking."
  `https://kubernetes.io/docs/concepts/cluster-administration/networking/`
- Proxmox VE Documentation, "Cluster Manager" (Corosync dedicated-network recommendation).
  `https://pve.proxmox.com/pve-docs/chapter-pvecm.html`
- Prior research (context only, not duplicated):
  [docs/research/unifi-segmentation-research.md](https://github.com/aaronkyriesenbach/catalyst/blob/research/unifi-segmentation-research/docs/research/unifi-segmentation-research.md)
