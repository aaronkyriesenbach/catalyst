# Research: Current UniFi Hardware's VLAN/Segmentation Capabilities

Ticket: [#4](https://github.com/aaronkyriesenbach/catalyst/issues/4), part of the
"Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

## TL;DR

- The repo confirms a **UniFi OS console** gateway (UDM-family software stack — `unifi-core`
  service, console-style `/api/auth/login` + `/api/userCertificates` local API), but **does not
  name the exact hardware model or UniFi Network application version**. This must be confirmed
  against the live device — see "What could not be determined" below.
- Whatever the exact model, **every current UniFi gateway (UDR, UXG-Lite/Max, UDM/UDM-Pro/UDM-SE/UDM-Pro-Max)
  supports VLANs, a stateful Layer-7 firewall, and VLAN/subnet-based traffic segmentation** as a
  baseline feature — this is a software-stack (UniFi OS / UniFi Network application) capability,
  not something gated behind the flagship-only models. Differences between models are about
  **throughput/scale ceilings** (IDS/IPS Gbps, port count, MAC table size, managed-device count),
  not the presence of VLAN/firewall/segmentation features themselves.
- The current UniFi Network application (9.0+) replaced the old per-network-type firewall rule
  system with a **Zone-Based Firewall (ZBF)**: interfaces (VLANs/WANs/VPNs) are grouped into zones
  (Internal, External, Gateway, VPN, Hotspot, DMZ, or custom), and policies are defined per
  source→destination zone pair in a visual "Zone Matrix." This is the currently-documented,
  supported segmentation mechanism and is what any new VLAN plan should target.
- **The router hardware is not the constraint for VLAN/segmentation-based rearchitecture** — the
  UniFi OS software stack supports everything needed (VLANs, inter-VLAN firewalling, zone
  policies, ACLs at the switch layer, RADIUS-based dynamic VLAN assignment). The constraint, if
  any, will be **scale/throughput on whichever specific box is in the rack** (e.g., IDS/IPS
  throughput and managed-device counts on cheaper UXG-Lite vs. UDM-Pro-Max), which needs a
  physical/UI confirmation of the model to size correctly.

## How the hardware was investigated

- `rg -i unifi` across the catalyst repo (`/home/aaron/repos/catalyst`, read-only) turned up:
  - `apps/traefik/externalApps.config.ts`: a proxied external app named `unifi` at
    `192.168.1.1:443`, `certDeploy: { type: "unifi-local-api" }`.
  - `apps/external-dns/internal-values.yaml`: `external-dns-unifi-webhook` image
    (`ghcr.io/kashalls/external-dns-unifi-webhook`) with `UNIFI_HOST: https://192.168.1.1`,
    talking to the UniFi **Network Integration API** (`X-API-KEY`) for DNS record management —
    this is a third-party (not Ubiquiti-authored) webhook, so it's evidence of *which API* is in
    use, not of the hardware model itself.
  - `docs/external-cert-rotation.md`: explicitly documents the cert-deploy flow as talking to the
    **"UniFi OS console"** at `192.168.1.1:443`, using an *undocumented* local API
    (`POST /api/auth/login` → `POST /api/userCertificates` → `PUT /api/userCertificates/{id}/status`),
    with a fallback of SSH file-drop to `/data/unifi-core/config/unifi-core.{crt,key}` +
    `systemctl restart unifi-core`. The `unifi-core` service and this file path are specific to
    **UniFi OS** consoles (the UDM/UDR/UXG product line running the unified UniFi OS, as opposed
    to legacy standalone USG/Cloud Key deployments, which don't run `unifi-core`).
  - No file names a specific model (UDM-Pro, UDM-SE, UDR, UXG-Lite, etc.) or a UniFi Network
    application version number.
- `kubectl get nodes -o wide` / `kubectl cluster-info`: cluster nodes (`node1`/`node2`) sit at
  `192.168.53.210`/`.220`, API server at `192.168.53.200` — confirming the flat `192.168.53.0/24`
  cluster network from `AGENTS.md`. This is a **different subnet** from the `192.168.1.1` address
  the repo uses for the UniFi console, which is the **out-of-the-box default LAN/management
  subnet** UniFi ships gateways with. That the console is still reachable at the factory-default
  `192.168.1.1` while cluster traffic lives on `192.168.53.0/24` suggests either (a) the console's
  management/default network was never renumbered off `192.168.1.0/24` even though a separate
  `192.168.53.0/24` network was created for the rest of the LAN, or (b) `192.168.1.1` is reachable
  cross-subnet via routing. Either way, this is worth reconciling once VLAN work starts, since it
  implies **the existing "flat /24" is already at least two networks under the hood**, not one.
- No direct `kubectl`/API path to the router itself exists in this cluster (it's not
  Kubernetes-managed infrastructure), so the model and Network application version were not
  independently verifiable in this session.

### What could not be determined (needs user confirmation)

- **Exact gateway model.** Candidates, in likely order given a homelab of this scale (dual-node
  k3s cluster, TrueNAS, 2 Proxmox nodes): UDM-Pro, UDM-SE, UDR (Dream Router), UXG-Lite, or
  UXG-Max. Confirm via the UniFi OS console UI (Settings → System → About) or
  `https://192.168.1.1` → device details.
- **UniFi Network application version.** Zone-Based Firewall requires UniFi Network **9.0+** and
  gateway firmware **4.1+** (Ubiquiti, "Zone-Based Firewalls in UniFi," see Sources). If the
  console is on an older version, the legacy per-network-type firewall rules (`LAN_IN`,
  `WAN_LOCAL`, etc.) are what's in effect instead of zones — the migration is a one-click, no-downtime
  operation (Ubiquiti, "Migrating to Zone-Based Firewalls in UniFi").

## VLAN capabilities (all current UniFi Gateways)

Source: Ubiquiti Help Center, "Creating Virtual Networks (VLANs)"
(`help.ui.com/hc/en-us/articles/9761080275607`).

- VLANs are created under **Settings → Networks** ("Create New Network"); each virtual network
  gets a name, VLAN ID, subnet, DHCP scope, isolation, content-filtering, and DNS settings.
- **By default, VLANs do not auto-assign devices** — devices/clients must be explicitly placed
  onto a VLAN by one of the assignment methods below.
- Device-to-VLAN assignment methods, in increasing order of flexibility:
  - **Static, SSID-based**: map a WiFi SSID to one VLAN; or use **PPSK (Per-Password VLAN)** to
    put different clients on different VLANs from the *same* SSID based on which password they
    used.
  - **Static, switch-port-based**: pin a wired port (access or trunk) to a VLAN — ideal for
    servers/printers/fixed workstations.
  - **Dynamic, RADIUS username/password (802.1X)**: VLAN assigned per authenticated user/role.
  - **Dynamic, RADIUS MAC-based**: VLAN assigned per device MAC address regardless of which AP/
    switch port it connects through — useful for IoT/cameras that must always land on the same
    VLAN. Requires a UniFi Gateway.
  - **Virtual Network Override (VNO)**: gateway-level dynamic VLAN assignment by MAC address
    without needing RADIUS/802.1X — useful where WPA3-Enterprise isn't supported by a client, or
    as a PPSK alternative on 6 GHz (where PPSK isn't available). Requires a UniFi Gateway.
- **"VLAN Magic"**: a simplified, MAC-address-based bulk VLAN-creation shortcut in the Topology
  view, meant for smaller sites. **Not supported downstream of**: USW Flex, USW Flex Mini, USW
  Ultra, USW Flex 2.5G series, or ECS Aggregation switches.
- **Third-party gateways**: if the UniFi Gateway itself is *not* doing routing (not applicable
  here, since this homelab's gateway is a UniFi console), VLANs must be created on the third-party
  gateway first and then mirrored into UniFi Network with a matching VLAN ID; most third-party
  gateways block inter-VLAN routing by default and require explicit firewall/routing config on
  that gateway. (Not directly relevant here since the UniFi console itself is the router, but
  worth knowing in case any switch/AP-only gear from another vendor sits downstream.)

## Firewall & segmentation model — Zone-Based Firewall (current, UniFi Network 9.0+)

Source: Ubiquiti Help Center, "Zone-Based Firewalls in UniFi"
(`help.ui.com/hc/en-us/articles/115003173168`), and "Migrating to Zone-Based Firewalls in UniFi"
(`help.ui.com/hc/en-us/articles/28223082254743`).

- **Requirements**: UniFi Cloud Gateway (or independent UniFi Gateway), UniFi Network application
  9.0+, gateway firmware 4.1+.
- **Firewall Zones** group network interfaces (VLANs, WANs, VPNs) into logical buckets so
  policies are defined zone→zone instead of per-interface. Built-in zones:
  - **External** — untrusted, e.g. general WAN Internet traffic, third-party VPN clients.
  - **Internal** — trusted LAN traffic (employee machines, internal servers).
  - **Gateway** — traffic to/from the UniFi Gateway itself (DHCP, DNS, HTTPS/SSH mgmt).
  - **VPN** — remote-user VPN (Identity One-Click VPN, WireGuard, L2TP, OpenVPN) and site-to-site
    VPN (Site Magic, IPsec, OpenVPN).
  - **Hotspot** — guest WiFi hotspot networks, restricted by default.
  - **DMZ** — for networks that need to expose public-facing services (web/mail servers).
  - Custom zones can also be created; each network interface belongs to exactly one zone
    (assignable/movable in the Firewall section or at network-creation time).
- **Default Zone Matrix behavior** (as documented): Internal→everything is "Allow All" except
  Internal→External which is policy-driven; External→anything is policy-driven both ways;
  Hotspot/DMZ→Internal/External is policy-driven, and Hotspot/DMZ→Hotspot/DMZ is "Block All" by
  default. Filtering direction matters — a rule blocking A→B does not imply B→A is blocked, and
  vice versa, so both directions must be considered explicitly.
- **Intra-zone filtering is supported** — e.g., Internal→Internal — useful when several VLANs
  share the same zone but still need traffic filtered between them (this is the mechanism you'd
  use to keep multiple internal VLANs on the "Internal" zone but still firewall between them,
  rather than needing a fully custom zone per VLAN).
- **Policy configuration** (path depends on Network app version — 9.4: Settings → Zones → Create
  Policy, or Settings → Policy Table; 9.3: Settings → Policy Engine → Zones → Create Policy):
  - Match on source/destination zone, plus optional refinement by device, network, IP/MAC, port
    (any/specific/object), application, domain, or geographic region.
  - Actions: **Allow**, **Auto Allow Return Traffic** (auto-creates the matching return-path
    policy), **Block** (silent drop), **Reject** (drop + notify sender).
  - Optional restrictions: IPv4/IPv6/both, protocol (TCP/UDP/ICMP/other), connection state
    (new/established/invalid), syslog logging to a remote SIEM, and time-based schedules.
  - Custom rules take precedence over built-in rules by default but are ordered relative to other
    custom rules via a "Reorder" control (rule-index-style ordering, same underlying model as the
    legacy system below).
- **Migration** from the legacy rule sets is one-click (Security → Traffic & Firewall Rules →
  Upgrade), zero-downtime, and maps old rulesets (`LAN_IN`/`LAN_OUT`/`LAN_LOCAL`,
  `GUEST_IN`/`GUEST_OUT`/`GUEST_LOCAL`, `WAN_IN`/`WAN_OUT`/`WAN_LOCAL`) onto zone pairs
  conservatively (may produce redundant-but-harmless rules, safe to prune after validation).

### Legacy firewall model (pre-9.0, in case the console hasn't been upgraded)

Source: Ubiquiti Help Center, "UniFi Gateway - Advanced Firewall Rules"
(`help.ui.com/hc/en-us/articles/27699646208279`, now marked outdated in favor of ZBF).

- Rules are grouped by **network type** (Internet/LAN/Guest, and IPv6 equivalents) and
  **direction** (`Local` = destined for the gateway itself, `In` = ingress into other networks,
  `Out` = egress toward this network).
- Rules can match **connection state** (New/Established/Related/Invalid) and, for site-to-site
  IPsec VPNs, can specifically match IPsec vs. non-IPsec traffic.
- Execution order is by numeric **Rule Index** (lower = evaluated first); new rules can be placed
  before/after the predefined ones. Ordering mistakes are a common cause of "my rule isn't working."
- Ubiquiti's own recommendation, even under the legacy model, was to use the simplified "Simple
  Rules" UI for common cases like VLAN segmentation rather than hand-writing advanced rules.

## Unified Traffic & Policy Management (current UI umbrella)

Source: Ubiquiti Help Center, "Traffic & Policy Management in UniFi"
(`help.ui.com/hc/en-us/articles/5546542486551`).

All of the following are configured from one **Policy Engine** in current UniFi Network:

- Zone-Based Firewall (as above)
- Application filtering (block/allow specific apps or categories)
- Policy-Based Routing (steer traffic to a specific WAN or through a VPN tunnel)
- QoS (traffic shaping, WiFi speed limits, prioritization)
- ProAV traffic optimization (latency-sensitive AV workflows)
- **Access Control Lists (ACLs)** on switches — block/allow traffic directly at the switch for
  low-latency, non-gateway-dependent segmentation (see "UniFi Switches and Access Control Lists
  (ACLs)," `help.ui.com/hc/en-us/articles/23352709241495`), including client-to-client isolation
  within the same network.
- Content/domain filtering, NAT/port-forwarding, custom DNS records/hostnames.
- **Object Manager** (Network 9.4+): an outcome-driven alternative to hand-building rules — pick
  Devices/Device Groups/Networks, then choose **Secure** (Internet allow/block-list or full
  isolation; Local firewall/ACL-based isolation), **Route** (policy-based routing), and/or **QoS**
  outcomes, and UniFi auto-generates the necessary firewall/ACL rules and decides whether to
  enforce at the gateway (firewall) or switch (ACL) layer based on traffic direction and topology.

## Network & client isolation specifics

Source: Ubiquiti Help Center, "Implementing Network and Client Isolation in UniFi"
(`help.ui.com/hc/en-us/articles/18965560820247`) and "UniFi Switches and Access Control Lists
(ACLs)" (`help.ui.com/hc/en-us/articles/23352709241495`).

- Isolation tools operate at different layers and can be combined:
  - **Gateway-level (Zone-Based Firewall / legacy rules)**: block traffic between VLANs/zones
    entirely — the primary mechanism for "these two networks should never talk."
  - **Switch-level (ACLs)**: block/allow specific flows directly on switch hardware, including
    **client device isolation** (block all communication between devices within the *same*
    network) — useful for guest/IoT segments where even same-VLAN peer traffic should be blocked,
    without needing gateway round-trips.
  - **AP-level**: SSID-level client isolation for wireless guest networks.

## Hardware/model scale comparison (official tech specs)

Source: Ubiquiti official tech-specs pages (`techspecs.ui.com/unifi/cloud-gateways/<model>`),
current as fetched. **VLAN/Subnet-based Traffic Segmentation** and the full Zone-Based Firewall
feature set (stateful firewall, Layer‑7 app-aware filtering, DPI, content filtering, IDS/IPS, ad
blocking) are listed as supported (✓) across every current gateway checked below — they are
software-stack features, not hardware-gated. What differs is scale/throughput:

| Model | IDS/IPS throughput | Managed UniFi devices | Simultaneous clients | MAC table size | Notes |
|---|---|---|---|---|---|
| UXG-Lite | 1 Gbps | — | — | — | No 10G/2.5G ports; compact desktop; no listed IDS/IPS signature count |
| UDR (Dream Router) | 1 Gbps | 20+ | 150+ | 1,000 | Has built-in WiFi 6 AP; 1 GbE WAN only |
| UXG-Max | 2.3 Gbps | — | — | 2,000 | 2.5GbE ports, up to 4 WAN |
| UDM-Pro | 3.5 Gbps | 100+ | 1,000+ | 4,000 | Rack 1U, 10G SFP+/1G ports, NVR bay |
| UDM-SE | 3.5 Gbps | 100+ | 1,000+ | 4,000 | Same throughput class as UDM-Pro, adds 2.5GbE port + internal switch |
| UDM-Pro-Max | 5 Gbps | 200+ | 2,000+ | 4,000 | Highest-throughput console-class gateway |

Every model in this table lists "VLAN/Subnet-based Traffic Segmentation: ✓" and the same
Zone-Based-Firewall-era security feature checklist (Stateful Firewall, Application-Aware Layer 7
Firewall, DPI & Traffic Identification, Zone-Based Firewall Advanced Filtering, Content Filtering,
IDS/IPS, Ad Blocking) — confirming segmentation capability is not the limiting factor regardless
of which of these is actually racked in this homelab. **The MAC address table size and IDS/IPS
throughput are the numbers worth checking against actual planned VLAN/device count** once the
model is confirmed, since a from-scratch VLAN rollout with many IoT/segmented devices could
approach a lower-end box's table/throughput ceiling under heavy IDS/IPS + multi-VLAN load.

## Recommended segmentation approaches for this hardware (any current UniFi console)

Given the router is fixed and every current console-class or compact UniFi Gateway supports the
same underlying VLAN + Zone-Based Firewall + ACL feature set, a full segmentation rearchitecture
away from the current flat `192.168.53.0/24` is achievable purely in software/config, in roughly
this order of effort:

1. **Confirm the exact model and UniFi Network application version** first — determines whether
   Zone-Based Firewall is already available (9.0+) or a one-click migration is needed, and sets
   real throughput/scale expectations (see table above).
2. **Reconcile the `192.168.1.1` vs. `192.168.53.0/24` discrepancy** found in this repo — determine
   whether the console's default/management network is still separate from the "flat /24" the
   rest of the docs describe, since that affects how many networks already exist today.
3. **Create purpose-built VLANs** (Settings → Networks) for at least: cluster/infra
   (`192.168.53.0/24`'s current role), NAS/storage, management/out-of-band, and
   IoT/untrusted, each with its own subnet and DHCP scope.
4. **Assign devices to VLANs** using the static methods first (switch-port pinning for the k3s
   nodes/NAS/Proxmox hosts, since they're fixed-location wired devices) — this needs zero RADIUS
   infrastructure and matches this homelab's single-operator, low-churn device set.
5. **Model the target segmentation as Zones**, not ad hoc rules: keep infra/cluster/NAS on
   "Internal," put anything untrusted/IoT into a custom zone (or the built-in Hotspot zone if
   it's guest-style), and use the Zone Matrix to explicitly allow only the specific cross-zone
   flows the cluster needs (e.g., Traefik/ArgoCD reaching Proxmox/TrueNAS/UniFi admin APIs on
   specific ports) while defaulting everything else to Block.
6. **Use switch ACLs for same-VLAN isolation** where needed (e.g., isolating individual IoT
   devices from each other even though they share a VLAN) rather than proliferating VLANs for
   every single device class.
7. **Adopt the Object Manager (Network 9.4+)** if available, to express intent ("isolate this
   device group," "route this traffic via VPN") rather than hand-authoring firewall+ACL pairs —
   reduces the chance of asymmetric-direction mistakes described in the Zone Matrix docs.

## Sources

All primary, Ubiquiti-owned (Ubiquiti Help Center at `help.ui.com`, or Ubiquiti's own tech-specs
site at `techspecs.ui.com`) unless noted. Help Center pages fetched via Wayback Machine snapshots
because `help.ui.com` is Cloudflare-bot-gated for direct fetches from this environment; content
was verified as an exact mirror of the live Ubiquiti Help Center article (canonical URL, title,
and body match).

- Ubiquiti Help Center — "Creating Virtual Networks (VLANs)":
  https://help.ui.com/hc/en-us/articles/9761080275607-Creating-Virtual-Networks-VLANs
- Ubiquiti Help Center — "Using VLANs for Network Security and Performance":
  https://help.ui.com/hc/en-us/articles/26136851868695-Using-VLANs-for-Network-Security-and-Performance
- Ubiquiti Help Center — "Zone-Based Firewalls in UniFi":
  https://help.ui.com/hc/en-us/articles/115003173168-Zone-Based-Firewalls-in-UniFi
- Ubiquiti Help Center — "Migrating to Zone-Based Firewalls in UniFi":
  https://help.ui.com/hc/en-us/articles/28223082254743-Migrating-to-Zone-Based-Firewalls-in-UniFi
- Ubiquiti Help Center — "Traffic & Policy Management in UniFi":
  https://help.ui.com/hc/en-us/articles/5546542486551-Traffic-Policy-Management-in-UniFi
- Ubiquiti Help Center — "UniFi Gateway - Advanced Firewall Rules" (legacy, superseded by ZBF):
  https://help.ui.com/hc/en-us/articles/27699646208279-UniFi-Gateway-Advanced-Firewall-Rules
- Ubiquiti Help Center — "Implementing Network and Client Isolation in UniFi":
  https://help.ui.com/hc/en-us/articles/18965560820247-Implementing-Network-and-Client-Isolation-in-UniFi
- Ubiquiti Help Center — "UniFi Switches and Access Control Lists (ACLs)":
  https://help.ui.com/hc/en-us/articles/23352709241495-UniFi-Switches-and-Access-Control-Lists-ACLs
- Ubiquiti Tech Specs — UDM-Pro: https://techspecs.ui.com/unifi/cloud-gateways/udm-pro
- Ubiquiti Tech Specs — UDM-SE: https://techspecs.ui.com/unifi/cloud-gateways/udm-se
- Ubiquiti Tech Specs — UDM-Pro-Max: https://techspecs.ui.com/unifi/cloud-gateways/udm-pro-max
- Ubiquiti Tech Specs — UDR (Dream Router): https://techspecs.ui.com/unifi/cloud-gateways/udr
- Ubiquiti Tech Specs — UXG-Lite: https://techspecs.ui.com/unifi/cloud-gateways/uxg-lite
- Ubiquiti Tech Specs — UXG-Max: https://techspecs.ui.com/unifi/cloud-gateways/uxg-max
- Repo evidence (read-only, `/home/aaron/repos/catalyst`): `apps/traefik/externalApps.config.ts`,
  `apps/external-dns/internal-values.yaml`, `docs/external-cert-rotation.md`
- Cluster evidence: `kubectl get nodes -o wide`, `kubectl cluster-info` (live cluster)

## Open questions for the user

1. What is the exact console model (UDM-Pro / UDM-SE / UDM-Pro-Max / UDR / UXG-Lite / UXG-Max /
   other)? Check Settings → System → About in the UniFi OS console UI.
2. What UniFi Network application version is currently running — is Zone-Based Firewall already
   active, or does the one-click migration still need to happen?
3. Why does the repo reference the console at `192.168.1.1` (UniFi's factory-default LAN) while
   the rest of the cluster lives on `192.168.53.0/24` — is there already a second, un-migrated
   network in play?
