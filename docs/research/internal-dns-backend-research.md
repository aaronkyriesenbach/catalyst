# Research: Internal DNS backend options — UniFi built-in DNS vs. a dedicated platform DNS server

Ticket: [aaronkyriesenbach/catalyst#43](https://github.com/aaronkyriesenbach/catalyst/issues/43), child of
the "Homelab platform rearchitecture" wayfinder map
([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)); blocks decision ticket
[#15](https://github.com/aaronkyriesenbach/catalyst/issues/15) ("Decide DNS approach"). Explicitly framed
as a gap left by two prior efforts: [#14](https://github.com/aaronkyriesenbach/catalyst/issues/14)
("Research: DNS management options, re-evaluated holistically"), which punted the internal-backend
question to VLAN/segmentation research, and [#4](https://github.com/aaronkyriesenbach/catalyst/issues/4)
("Research: current Unifi hardware's VLAN/segmentation capabilities"), which never covered DNS backend
alternatives at all.

## Question

Compare keeping UniFi's built-in DNS (dnsmasq-backed, current `external-dns-unifi-webhook` setup) against
standing up a dedicated internal DNS server as part of the rearchitected platform, for
`int.lab53.net`-style internal records — without assuming a winner. Candidates: the status quo; ExternalDNS's
in-tree CoreDNS provider (etcd-backed); a dedicated self-hosted resolver (Technitium DNS Server, AdGuard
Home, Pi-hole, or others worth surfacing) with UniFi DHCP pointing clients at it. Evaluate: GitOps/Gateway-API
declarative fit; record-type support (wildcards, multi-target CNAME); operational cost of a new backend;
how DHCP-assigned clients get pointed at whichever resolver wins; interaction with the already-decided
VLAN/zone topology; single-operator homelab fit. For every non-UniFi candidate: whether it runs easily as a
workload on the platform cluster (Helm chart/manifests, storage needs against the already-decided storage
backends, LAN exposure at a stable IP, any CRD/operator option), or whether it instead expects a standalone
VM/appliance.

## What's actually running today

Read directly from `apps/external-dns.ts` and its values files (this repo, main worktree, read at research
time):

- **`external-dns-int`** — Helm chart `external-dns` v1.20.0 from
  `https://kubernetes-sigs.github.io/external-dns/`, `provider.name: webhook`, webhook image
  `ghcr.io/kashalls/external-dns-unifi-webhook:v0.8.2`, talking to the UniFi controller at
  `https://192.168.1.1`. `sources: ["gateway-httproute"]`, `domainFilters: ["lab53.net"]`, `policy: sync`,
  watching the `traefik-internal` Gateway (`extraArgs.gateway-name`/`gateway-namespace`). This writes
  records into UniFi's own DNS (dnsmasq-backed).
- **`external-dns-ext`** — same chart/version, `provider.name: aws` (in-tree Route53 provider),
  `domainFilters: ["lab53.net"]` excluding `int.lab53.net`, watching `traefik-external`. Out of scope for
  this ticket — see #14's resolution, already settled.
- The image path in `internal-values.yaml` (`ghcr.io/kashalls/external-dns-unifi-webhook`) is a stale
  reference: GitHub confirms this project moved to the `home-operations` GitHub org (`301` redirect via
  `api.github.com/repos/kashalls/external-dns-unifi-webhook`), and the current canonical path is
  `ghcr.io/home-operations/external-dns-unifi-webhook`. The pinned tag (`v0.8.2`) is also well behind
  current (`v0.10.9` as of this research, per the [releases
  page](https://github.com/home-operations/external-dns-unifi-webhook/releases)) — a housekeeping item, not
  a shape change, already flagged by #14's research.

## Already-decided context this research must design against

Read directly from the closed decision tickets (not re-litigated here):

- **VLAN/zone topology** ([#5](https://github.com/aaronkyriesenbach/catalyst/issues/5), resolution
  comment): 6 VLANs / 3 zones — Home zone (Trusted `10.0.10.0/24`, IoT `10.0.20.0/24`, Guest
  `10.0.30.0/24`), Lab zone (Infra `10.53.40.0/24`, Storage `10.53.50.0/24`), Management zone
  (`10.53.60.0/24`). Cross-zone flows are default-deny except an explicit allow-list; Home(Trusted)→Lab
  (Infra) already allows `kubectl`/SSH (6443/22) because that's a confirmed live workflow.
- **Platform cluster** ([#8](https://github.com/aaronkyriesenbach/catalyst/issues/8), resolution + ADR
  0002): a dedicated, eventually-3-control-plane-node Kubernetes cluster hosts every shared platform
  service (observability, secrets-sync, DBaaS operator, registry, identity infra, GitOps hub, etc.),
  enforced with a taint + matching toleration — "everything platform-shaped runs there, with nothing
  deliberately kept external for its own sake."
- **Workload cluster partition** (ADR 0003, `CONTEXT.md`): workload clusters are split into an
  **External workload cluster** (owns the external-facing gateway/public DNS) and an **Internal workload
  cluster** (internal-only apps, no public ingress) — 3 clusters total including the platform cluster.
  ExternalDNS instances watch Gateway/HTTPRoute resources in-cluster (no cross-cluster HTTPRoute-watching
  mechanism exists), so `external-dns-int`-equivalent instances necessarily run on whichever cluster hosts
  `traefik-internal` — today that's a single cluster, but under the target topology that's specifically the
  Internal workload cluster, not the platform cluster. This is a separate placement question from where the
  **DNS backend itself** (the resolver ExternalDNS writes into) runs, which is what this ticket is about.
- **RWX/storage backend** ([#23](https://github.com/aaronkyriesenbach/catalyst/issues/23), ADR 0005):
  `truenas-nfs` StorageClass (`reclaimPolicy: Retain`) for shared/bulk file storage; `truenas-iscsi`/
  `truenas-nvmeof` (RWO only, `reclaimPolicy: Delete`) for runtime/stateful-workload storage, with
  `Recreate`-strategy downtime **explicitly accepted** as the standing decision for single-writer apps —
  "no centralized-storage option removes it without an unacceptable trade-off." RWX-via-clustered-filesystem
  (GFS2/OCFS2) is ruled out permanently, including because Talos (the target OS) compiles those filesystems
  out of its kernel entirely. `CONTEXT.md`'s own **Runtime storage** definition — "block storage for a
  single app's own exclusive-access working data" — is the exact shape a self-hosted DNS resolver's config
  volume takes (single active writer, small data, needs no RWX).
- **No LoadBalancer/MetalLB decision exists.** Searching all wayfinder-map tickets
  (`gh issue list -R aaronkyriesenbach/catalyst --state all`) turns up no ticket for a load-balancer
  implementation, and the repo has zero `type: LoadBalancer` Services or MetalLB references anywhere
  (confirmed via `rg -n "LoadBalancer|MetalLB|externalIPs|hostNetwork" apps/` in the main worktree — the
  only hit is an unrelated `hostNetwork: true` in the TrueNAS CSI driver's vendored manifest). Ingress
  placement is still an open decision ([#36](https://github.com/aaronkyriesenbach/catalyst/issues/36),
  open). **Any candidate that needs a stable, LAN-reachable IP for raw UDP/TCP port 53 (not an HTTP(S)
  Gateway route) depends on this unresolved LB story** — flagged as an open dependency throughout this
  research, not assumed away.

## Candidate 1: Status quo — UniFi's built-in DNS (dnsmasq-backed)

Already researched in depth by #14 (`docs/research/dns-research.md`, branch `research/dns-research`) —
summarized here, not re-derived, with one addition (Pi-hole's shared lineage, see Candidate 3):

- UniFi's Network Integration API (`developer.ui.com/network/`) is a real, documented, versioned API; the
  webhook (`home-operations/external-dns-unifi-webhook`) is actively maintained (27 releases visible in its
  changelog history, latest `v0.10.9` at research time) and explicitly documents its own limitation
  surface: **"UniFi uses [dnsmasq](https://dnsmasq.org) as its DNS backend, so the provider inherits its
  constraints: Wildcards (`*.example.com`) are not supported. One CNAME per name"** (webhook's own README,
  "Limitations" section, fetched directly at research time). This is a ceiling in UniFi/dnsmasq itself, not
  a fixable webhook bug.
- **GitOps/Gateway API fit: full.** `sources: ["gateway-httproute"]` already works today, confirmed live in
  `internal-values.yaml`.
- **Operational cost: zero new infrastructure.** No new VM/pod, no new stateful dependency — it reuses the
  router that's there regardless of any decision this ticket makes.
- **VLAN/zone interaction:** none — DNS just rides on whatever network the UniFi console's management
  plane already occupies (Management zone, `10.53.60.0/24`, per #5's resolution).
- **DHCP interaction:** none needed — UniFi is already the DHCP server, so "UniFi resolver" and "DHCP-handed
  resolver" are the same box today, requiring no client reconfiguration.

## Candidate 2: ExternalDNS in-tree CoreDNS provider (etcd-backed)

**Confirmed in-tree, not a webhook** — `provider/coredns/coredns.go` exists directly in
`kubernetes-sigs/external-dns`'s source tree (confirmed via the GitHub API contents listing for
`provider/coredns/`), and `CoreDNSPrefix`/`CoreDNSStrictlyOwned` are first-class fields on
`externaldns.Config` (`pkg/apis/externaldns/types.go`), not routed through the generic webhook provider
path.

### What it actually requires

- **A hard etcd dependency, unconditionally.** `provider/coredns/coredns.go` imports
  `go.etcd.io/etcd/client/v3` directly — there is no alternate backend option for this provider. CoreDNS
  itself confirms the same coupling from its own side: the *etcd* plugin's own README states plainly, "The
  *etcd* plugin implements the (older) SkyDNS service discovery service. It is *not* suitable as a generic
  DNS zone data plugin. Only a subset of DNS record types are implemented, and subdomains and delegations
  are not handled at all" (`coredns/coredns` `plugin/etcd/README.md`, fetched directly). This plugin is
  still compiled into CoreDNS today (confirmed present in the current
  [`plugin.cfg`](https://github.com/coredns/coredns/blob/master/plugin.cfg)), but its own maintainers
  frame it as a legacy compatibility layer, not the modern primary-zone-data path (that's the `file`/
  `kubernetes`/`hosts` plugins instead, none of which are ExternalDNS-writable at runtime the way `etcd` is).
- **Running the etcd cluster yourself is a real, separate stateful workload** — and the "obvious" way to
  get one is dead. The official CoreDNS Helm chart (`coredns/helm`, active — last push within the last two
  weeks of this research) documents a third deployment mode, "CoreDNS as an external dns provider for
  kubernetes federation... uses etcd plugin for CoreDNS backend. This deployment mode as a dependency on
  `etcd-operator` chart, which needs to be pre-installed" (chart README, fetched directly). That
  `etcd-operator` (CoreOS/`coreos/etcd-operator`) is **archived, last pushed 2020-04-03** (confirmed via the
  GitHub API: `archived: true`) — it's been dead for years. The community has not converged on a settled
  replacement: `etcd-io/etcd-operator`, badged "the official Kubernetes operator for etcd," is itself young
  (created 2024-08-07, 158 stars, only two tagged releases — `v0.1.0`/`v0.2.0` — and its own README is still
  the unfilled Kubebuilder scaffold template with a literal `// TODO(user): Add detailed information on how
  you would like others to contribute`, no Helm chart, install via `kubectl apply -k` or a hand-built
  installer). The Bitnami `etcd` chart is a workable, actively-maintained alternative (`Kubernetes 1.23+`,
  `Helm 3.8.0+`, `PV provisioner support in the underlying infrastructure` required per its own
  Prerequisites), but it's explicitly a general-purpose etcd cluster chart, not anything CoreDNS-federation
  specific, and Bitnami's own chart docs increasingly point toward its commercial "Secure Images" model
  (`bitnami/charts` `etcd` README opens by pitching "Bitnami Secure Images... FIPS, STIG, and air-gap
  options... commercial subscriptions to BSI") — a live-but-shifting-terrain dependency, not a
  settled, low-maintenance one.
- **A 3-node etcd deployment needs RWO block storage per replica plus a `Parallel` Pod Management Policy**
  (Bitnami chart README: "It sets a 'Parallel' Pod Management Policy... critical, since all the etcd
  replicas should be created simultaneously"). This maps cleanly onto the already-decided
  `truenas-iscsi`/`truenas-nvmeof` **Runtime storage** pattern (one PVC per replica, RWO, `Recreate`-class
  semantics already accepted platform-wide) — technically compatible with the existing storage decision,
  but it's a wholly new 3-replica stateful fleet purely to back DNS, which is a materially bigger footprint
  than any other candidate here.
- **Record-type ceiling, ironically, still exists** — just a different one. The etcd plugin's own README
  ("It is *not* suitable as a generic DNS zone data plugin. Only a subset of DNS record types are
  implemented") means this path trades dnsmasq's wildcard/CNAME ceiling for a different, also-real
  ceiling, in exchange for taking on etcd as new infrastructure.

### Fit for this platform

- **GitOps/Gateway API fit:** yes — `sources: ["gateway-httproute"]` is a Source-layer concept, decoupled
  entirely from Provider choice in ExternalDNS's own architecture (confirmed via the repo's own directory
  split: `source/gateway_httproute.go` lives independently of any `provider/*` package, and the UniFi
  webhook's own README explicitly documents this decoupling: "Domain filtering is handled by the
  ExternalDNS controller, not by this webhook," following the documented
  [`GetDomainFilter` contract](https://github.com/kubernetes-sigs/external-dns/blob/v0.21.0/docs/contributing/sources-and-providers.md#implementing-getdomainfilter)).
  So yes, CoreDNS-as-provider would work with the existing `gateway-httproute` source unchanged.
- **Runs as a cluster workload?** Yes, cleanly — official Helm chart, official image, no CRD needed for
  CoreDNS itself. The etcd dependency is the actual obstacle, not CoreDNS.
- **LAN exposure at a stable IP:** CoreDNS itself would need to be exposed on UDP/TCP 53 to the LAN for
  DHCP-pointed clients — the same open LoadBalancer/MetalLB dependency flagged above applies here, same as
  every other cluster-hosted candidate in this document.
- **Single-operator homelab fit: poor.** This is the most infrastructure-heavy candidate by a wide margin —
  a new multi-replica stateful etcd fleet, on a still-consolidating operator ecosystem (dead
  `etcd-operator`, an infant `etcd-io/etcd-operator`, a commercially-drifting Bitnami chart), purely to
  back an internal DNS zone with no current wildcard/multi-CNAME requirement (per #14's own finding: "Today's
  actual internal hostnames are simple `A`/single-target records... nothing in the current app set needs
  wildcards or multi-CNAME"). This is the textbook "solving a problem you don't have yet, at a cost far out
  of proportion to the need" candidate.

## Candidate 3: Pi-hole as dedicated internal-DNS backend

**Important, easy-to-miss finding: Pi-hole has an in-tree ExternalDNS provider, not just community
webhooks** — `provider/pihole/pihole.go` lives directly in `kubernetes-sigs/external-dns`'s own source tree
(confirmed via GitHub API contents listing for `provider/`), alongside `route53`, `azure`, `cloudflare`,
etc. — a first-party integration, same tier as Route53.

### Record-type ceiling — and why it doesn't actually solve UniFi's problem

- Per the upstream tutorial (`docs/tutorials/pihole.md`, fetched directly): **"Pihole only supports A/AAAA/
  CNAME records so there is no mechanism to track ownership"** — the provider's own doc tells operators to
  set `--registry=noop` and `--policy=upsert-only` to cope, because there's no TXT-record-based ownership
  tracking the way Route53/CoreDNS/UniFi's webhook have.
- **The decisive finding: Pi-hole's DNS engine is dnsmasq, literally, not just dnsmasq-like.** Pi-hole's own
  `FTL` (`pihole-FTL`) repository README states this without qualification: **"FTLDNS will *disable* any
  existing installations of `dnsmasq`. This is because FTLDNS *is* `dnsmasq` + Pi-hole's code, so both
  cannot run simultaneously"** (`pi-hole/FTL` README, fetched directly). This is corroborated by a live,
  closed upstream bug: [`pi-hole/pi-hole#5925`](https://github.com/pi-hole/pi-hole/issues/5925), "Custom
  dnsmasq for local wildcard DNS no longer working in v6" — a user who relied on hand-edited
  `/etc/dnsmasq.d/*.conf` wildcard entries (`address=/home.xxx.com/192.168.1.11`) lost that capability when
  Pi-hole v6 changed its internal dnsmasq integration. **Choosing Pi-hole as "the dedicated resolver" does
  not escape the dnsmasq wildcard/CNAME ceiling that's the whole reason to consider replacing UniFi** — it's
  the same underlying DNS engine family, just running as a separate box instead of embedded in the router.
  This is a materially different finding than treating Pi-hole as generically "a self-hosted resolver
  option" — it specifically fails to solve the stated problem (dnsmasq's ceiling) that motivates leaving
  UniFi's built-in DNS in the first place.

### Kubernetes/platform fit

- **No official Helm chart.** Pi-hole's own `docker-pi-hole` repo ("The official Pi-hole Docker image from
  pi-hole.net") ships only a `docker-compose.yml`, no Kubernetes manifests or chart. A GitHub search for
  community Pi-hole Helm charts turns up a long tail of small, low-adoption, unofficial charts (e.g.
  `nunoferna/pihole-helm`, `JFWenisch/pihole-helm`, `SimonJPegg/pihole-k8s`) with no clear consensus
  "the" chart — the strongest signal of an ecosystem without a first-party or de-facto-standard
  Kubernetes packaging story.
- **Storage:** Pi-hole's persistent state is config/`dnsmasq.d` files plus an FTL long-term-stats SQLite
  database (`/etc/pihole`), not a clustered or RWX-shaped need — fits the **Runtime storage** pattern
  (single-writer, small volume) cleanly on `truenas-iscsi`/`truenas-nvmeof`, same as any other single-replica
  stateful app on this platform. No new storage primitive required.
- **LAN exposure:** same open LoadBalancer/MetalLB dependency as every cluster-hosted candidate.
- **DHCP:** Pi-hole includes a built-in DHCP server (its own `docker-compose.yml` shows a commented-out
  `67:67/udp` port), but the natural fit here is **not** to replace UniFi's DHCP — just to point UniFi's
  per-network DHCP-option-6 (DNS server) setting at Pi-hole's IP instead of the router's own resolver.
  UniFi's own "Creating Virtual Networks (VLANs)" Help Center article (already cited by
  `research/network-segmentation-research`) confirms each virtual network's configuration includes its own
  "DHCP scope... and DNS settings" as a per-network setting, which is the standard place this redirection
  would be configured; the exact article covering *custom upstream DNS server per network* specifically
  could not be independently re-fetched in this session (`help.ui.com` is Cloudflare-bot-gated for direct
  fetches, and Wayback Machine snapshot attempts for that specific page timed out/503'd) — flagged as
  unconfirmed in this pass rather than assumed, though it is standard, widely-documented UniFi behavior
  (DHCP Option 6 override per network).

## Candidate 4: AdGuard Home as dedicated internal-DNS backend

AdGuard Home is a from-scratch Go implementation, **not** a dnsmasq derivative — this matters directly for
the record-type ceiling question.

### Record-type support: wildcards confirmed first-party

AdGuard Home's own Knowledge Base ("AdGuard Home" → "Configuration",
`adguard-dns.io/kb/adguard-home/configuration/`, fetched directly) documents `rewrites` as: **"List of
legacy DNS rewrites, where `domain` is the domain or wildcard you want to be rewritten,"** with a worked
example:

```yaml
rewrites:
  - domain: example.com
    answer: 127.0.0.1
  - domain: '*.example.com'
    answer: A
```

This is genuine, first-party, documented wildcard support — the exact capability UniFi/dnsmasq and Pi-hole
both lack.

### ExternalDNS integration

No in-tree provider, but a genuinely mature third-party webhook exists:
[`muhlba91/external-dns-provider-adguard`](https://github.com/muhlba91/external-dns-provider-adguard) — 27
tagged releases (`v11.1.3` latest at research time), actively maintained since its creation in 2023-10-30,
Apache-2.0 licensed, with CI, test coverage reporting, and an OpenSSF Scorecard badge. It supports `A`,
`AAAA`, `CNAME`, `TXT`, `SRV`, `NS`, `PTR`, `MX` record types (README, "Supported DNS Record Types").
Mechanically, it manages AdGuard Home's Adblock-style filtering-rule syntax
(`|DNS.NAME^dnsrewrite=NOERROR;RECORD_TYPE;TARGET`) rather than the native `rewrites` config list the KB
docs above describe — the webhook's own README is explicit that it **takes ownership of all rules matching
that format** since AdGuard doesn't support inline comments for tracking per-record ownership the way a TXT
registry does, and recommends the ExternalDNS `crd` source (`DNSEndpoint` objects) for anything that needs
to coexist with manually-defined AdGuard rules. This webhook is clearly a step up in maturity from every
Technitium webhook found (see Candidate 5) and from Pi-hole's ownership-tracking gap — the closest
third-party analogue to how well-supported the UniFi webhook itself is.

### Kubernetes/platform fit

- **No official Helm chart from AdGuard itself** — `adguard-dns.io/kb/adguard-home/docker/` (fetched
  directly) documents only a `docker run` invocation with two bind-mount volumes
  (`/opt/adguardhome/work`, `/opt/adguardhome/conf`) and has zero mentions of Kubernetes anywhere in that
  page's content. Community Helm charts exist (`exploding-pear/adguard-home-helm-chart`,
  `FawenYo/adguard-home-chart`, etc.) but all show minimal adoption (0 stars each, at most a handful of
  commits) — same fragmented-ecosystem pattern as Pi-hole's chart landscape, just with fewer entries.
- **Storage:** same shape as Pi-hole — small config/work directories, single-writer, fits the **Runtime
  storage** pattern (`truenas-iscsi`/`truenas-nvmeof`) with no new storage primitive.
- **LAN exposure:** same open LoadBalancer/MetalLB dependency.
- **DHCP:** AdGuard Home also has a built-in DHCP server option, but again the natural fit is UniFi's
  existing DHCP pointing its DNS option at AdGuard's IP, not replacing UniFi as DHCP server.

## Candidate 5: Technitium DNS Server as dedicated internal-DNS backend

### Record-type support and a genuinely first-party integration path

Technitium's own README (`TechnitiumSoftware/DnsServer`, fetched directly) lists, among its features:
**"Wildcard sub domain support"** and **"Dynamic DNS Updates [RFC 2136] support with security policy."**
The second point is the most interesting finding of this research: **ExternalDNS ships an in-tree,
generic RFC2136 provider** (`provider/rfc2136/rfc2136.go`, using `miekg/dns` to construct standard DNS
UPDATE messages — no Technitium-specific code needed), and Technitium's own HTTP API docs
(`APIDOCS.md`, fetched directly) confirm zone-level dynamic-update support with a real ACL model:
`update` (`Deny`/`Allow`/`AllowOnlyZoneNameServers`/`UseSpecifiedNetworkACL`/...) and an
`updateNetworkACL` parameter for IP-based authorization — i.e., Technitium supports the exact protocol
ExternalDNS's most boring, first-party, non-webhook provider already speaks, authorizable purely by
source-IP ACL (e.g., the cluster's egress CIDR) without necessarily needing TSIG key management. **This
pairing (ExternalDNS `rfc2136` provider → Technitium's own RFC2136 endpoint) was not found documented or
demonstrated by anyone in this research pass** — it is a plausible, first-party-on-both-ends integration
path inferred from each side's own documentation, not a verified-working combination, and should be
prototyped before being relied on. It would, if it works as documented, be the only candidate in this
research that removes both the wildcard ceiling *and* the "trust a small community webhook" concern in one
step, using code that already ships in the official ExternalDNS Helm chart today.

### The webhook ecosystem, if the RFC2136 path doesn't pan out

Multiple independent community ExternalDNS webhooks for Technitium exist —
[`roosmaa/external-dns-technitium-webhook`](https://github.com/roosmaa/external-dns-technitium-webhook),
[`Bugs5382/external-dns-technitium-webhook`](https://github.com/Bugs5382/external-dns-technitium-webhook),
[`djr747/external-dns-technitium-webhook`](https://github.com/djr747/external-dns-technitium-webhook), and
others — but every one found has low adoption (2-3 GitHub stars) and no clear "one true" project the way
UniFi's `home-operations`-org webhook or AdGuard's `muhlba91` webhook are. `roosmaa`'s own README states
outright, in a top-of-file warning: **"This is homelab quality software, and not meant for production
usage. You have been warned."** This is a materially weaker footing than the UniFi webhook it would be
replacing (which lives under an active, multi-project GitHub org with a Discord and a real release
cadence) or the AdGuard webhook above.

### Kubernetes/platform fit

- **No official Helm chart or Kubernetes manifests from Technitium itself.** The project's own README
  documents Windows/Linux/macOS/Raspberry Pi installs and a Docker Hub image with a `docker-compose.yml`
  example only — no Kubernetes mention anywhere in the README or `DockerReadme`-equivalent docs. A GitHub
  search for Technitium Helm charts turns up exactly two low-adoption results
  (`Bugs5382/helm-technitium-chart`, 2 stars; `mabels/unified-dns-dhcp-chart`, 0 stars) — the thinnest
  Kubernetes-packaging ecosystem of any candidate surveyed here.
- **Storage:** the official `docker-compose.yml` mounts two volumes — `config:/etc/dns` and
  `logs:/var/log/technitium/dns` — flat config/zone data, not an embedded relational database with
  network-filesystem locking concerns (unlike SQLite/Postgres). Fits the **Runtime storage** pattern
  (single-writer, small block volume) with no new storage primitive needed, same as the other resolvers.
- **LAN exposure:** same open LoadBalancer/MetalLB dependency as every cluster-hosted candidate. Technitium's
  own `docker-compose.yml` explicitly calls out that DHCP deployments need `network_mode: "host"` — a
  further wrinkle if Technitium's *own* DHCP server were ever adopted (not the recommended path here; see
  below), since host networking doesn't compose cleanly with a normal Kubernetes Service/LoadBalancer model.
- **DHCP:** Technitium has a built-in DHCP server too, but again, pointing UniFi's existing per-network DHCP
  DNS option at Technitium's IP is the lower-friction path versus replacing UniFi as DHCP server.
- **Recognition/momentum**: Technitium is the most actively-covered of the three dedicated resolvers in
  independent press during this research window — its own README links an XDA Developers piece ("Technitium
  is the best local DNS tool you can deploy," Aug 2025) and a How-To Geek roundup (Nov 2025) — and its GitHub
  repo has the highest star count of the three (9,535, vs. AdGuard Home's 36,159 and Pi-hole's 60,402 — so
  actually the *lowest* of the three by raw stars, despite the more recent press attention; star count alone
  is a weak signal here and is reported for completeness, not as a deciding factor).

## A different framing worth naming explicitly: dnsweaver

One tool surfaced during this research doesn't fit neatly into "ExternalDNS + provider" but is worth
naming because it directly targets this exact niche: [`maxfield-allison/dnsweaver`](https://github.com/maxfield-allison/dnsweaver)
(179 stars, active), which bills itself as **"external-dns for the homelab"** and explicitly supports
Technitium, Pi-hole, AdGuard Home, and dnsmasq as first-class providers (its own README: "It speaks
self-hosted DNS. First-class Technitium, Pi-hole, AdGuard Home, and dnsmasq support. Not an afterthought,
and not alpha") alongside a native `kubernetes` source that reads Ingress/IngressRoute/HTTPRoute/Service
resources directly. It is a single static Go binary with no chart/CRD story of its own found in this
research, and would be a wholesale replacement of ExternalDNS rather than a provider plugged into it — a
bigger architectural swap than anything else considered here, and not evaluated further, but flagged since
it's a real, purpose-built alternative to "ExternalDNS + community webhook" that a future search on this
topic should know already surfaced.

## Cross-cutting: VLAN/zone placement for a dedicated resolver

Per #5's resolution, the Lab zone hosts Infra (`10.53.40.0/24`) and Storage (`10.53.50.0/24`); Management
(`10.53.60.0/24`) is its own zone. A dedicated resolver running **as a platform-cluster workload** would
naturally live wherever the platform cluster's nodes sit — i.e., the Infra VLAN, alongside every other
shared platform service, with no new VLAN needed. This is a materially simpler placement story than the
alternative of running it as a standalone VM/appliance, which would force a placement decision (Infra? A
new dedicated DNS VLAN? Management, since compromising DNS is close to compromising the network?) that #5's
resolution doesn't currently answer for any non-cluster workload. **This is itself a point in favor of a
cluster-hosted candidate over a standalone-VM one**, if a dedicated resolver is adopted at all — it reuses
an already-settled zone/VLAN placement rather than opening a new one.

## Recommendation

**Keep UniFi's built-in DNS as the internal DNS backend. Do not stand up a dedicated resolver or the
CoreDNS+etcd path at this time.** This confirms, rather than overturns, #14's earlier holistic-DNS verdict
— but this research closes the gap #14 left open by actually walking every alternative down to primary
sources instead of deferring the question, and the answer holds up:

- **No current requirement is unmet.** Per #14's own finding, reaffirmed here: today's internal hostnames
  are simple single-target `A`/`CNAME` records for Gateway API HTTPRoutes. Nothing in the current app set
  needs a wildcard record or a multi-target CNAME. Every candidate surveyed here exists to remove a ceiling
  that isn't currently being hit.
- **CoreDNS+etcd is disproportionate** — a multi-replica stateful etcd fleet, on an ecosystem whose
  "official" etcd Kubernetes operator is either dead (`coreos/etcd-operator`, archived since 2020) or in
  its infancy (`etcd-io/etcd-operator`, unfilled README, two releases), purely to unlock a record-type
  ceiling with zero current demand. This is the clearest "don't do this yet" of the candidates.
- **Pi-hole doesn't actually solve the stated problem.** It's dnsmasq under the hood (Pi-hole's own FTL
  README: "FTLDNS *is* `dnsmasq` + Pi-hole's code"), so it inherits the same wildcard ceiling UniFi has —
  adopting it would mean taking on a new stateful dependency, a fragmented/unofficial Helm-chart ecosystem,
  and the open LoadBalancer dependency, for **no capability gain** over the status quo.
- **AdGuard Home and Technitium are the two candidates that would genuinely raise the ceiling** (first-party
  wildcard support, confirmed via each project's own docs) — but both still require: (a) resolving the
  currently-open LoadBalancer/MetalLB question, since a DNS resolver needs a stable IP reachable at raw UDP/
  TCP port 53, which Traefik/Gateway API's HTTP(S)-shaped routing cannot provide; (b) accepting either a
  materially less-mature third-party ExternalDNS webhook (Technitium's community webhooks, one explicitly
  self-labeled "homelab quality, not meant for production usage") than the one already in use for UniFi, or
  a comparably mature one (AdGuard's `muhlba91` webhook) that still adds a new stateful workload and a new
  DNS-server-shaped attack surface where none exists today; and (c) no concrete driver (wildcard record,
  multi-target CNAME) currently asking for either capability.
- **If/when a real wildcard or multi-target-CNAME requirement appears**, the recommended next step, in
  order of preference given everything found here: **(1) Technitium via the ExternalDNS in-tree RFC2136
  provider** — first-party code on both ends, no third-party webhook trust surface, but *prototype the
  pairing first*, since it was not found demonstrated anywhere in this research; **(2) AdGuard Home via the
  `muhlba91` webhook** as the fallback if the RFC2136 pairing doesn't pan out — the most mature
  third-party webhook found for any dedicated-resolver candidate; **(3) CoreDNS+etcd only if a
  multi-cluster/federated DNS story independently justifies running etcd for other reasons** — not worth
  its operational cost for DNS alone. Pi-hole and the CoreDNS+etcd path are not recommended under any
  version of the "we now need wildcards" trigger, for the reasons above.
- **Whichever dedicated-resolver path is eventually chosen, it fits the platform's GitOps/Kubernetes-native
  model as a Deployment + small Runtime-storage-pattern PVC on the platform cluster** — none of the three
  resolvers evaluated needs anything more exotic than that, and all three explicitly lack an official Helm
  chart (a real but not disqualifying gap — none of them expect a standalone VM/appliance either; they're
  all plain single-container Docker images that containerize trivially). The one real blocker shared by
  every cluster-hosted candidate is the **currently-undecided LoadBalancer/MetalLB story** — resolving that
  (in #36 or a dedicated follow-up ticket) is a prerequisite for any of them, independent of which resolver
  is eventually chosen.

## Sources

Primary/first-party sources, fetched directly during this research:

- `apps/external-dns.ts`, `apps/external-dns/internal-values.yaml`, `apps/external-dns/external-values.yaml`
  (this repo, main branch, read at research time)
- `CONTEXT.md`, `docs/adr/0002-dedicated-platform-cluster.md`, `docs/adr/0005-storage-backend.md` (this
  repo, main branch)
- Catalyst issue tracker (via `gh issue view`/`gh issue list -R aaronkyriesenbach/catalyst`): #1, #4, #5, #8,
  #14, #15, #23, #36, #43, and full open/closed issue list confirming no LoadBalancer/MetalLB ticket exists
- Prior repo research (read directly, not re-derived): `docs/research/dns-research.md` (branch
  `research/dns-research`), `docs/research/network-segmentation-research.md` (branch
  `research/network-segmentation-research`), `docs/research/unifi-segmentation-research.md` (branch
  `research/unifi-segmentation-research`), `docs/research/runtime-storage-research.md` (branch
  `research/runtime-storage-research`)
- ExternalDNS README — <https://github.com/kubernetes-sigs/external-dns/blob/master/README.md>
- ExternalDNS CoreDNS tutorial —
  <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/coredns.md>
- ExternalDNS Pi-hole tutorial —
  <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/pihole.md>
- ExternalDNS RFC2136 tutorial —
  <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/rfc2136.md>
- ExternalDNS provider source — `provider/coredns/coredns.go`, `provider/pihole/pihole.go`,
  `provider/pihole/client.go`, `provider/rfc2136/rfc2136.go`, `pkg/apis/externaldns/types.go` (all
  `kubernetes-sigs/external-dns`, `master` branch, fetched directly)
- ExternalDNS source/provider directory listing (GitHub API contents endpoint) confirming Source/Provider
  decoupling and in-tree status of `coredns`/`pihole` (vs. `webhook`)
- ExternalDNS sources-and-providers contributing doc (`GetDomainFilter` contract) —
  <https://github.com/kubernetes-sigs/external-dns/blob/v0.21.0/docs/contributing/sources-and-providers.md>
- CoreDNS *etcd* plugin README — <https://github.com/coredns/coredns/blob/master/plugin/etcd/README.md>
- CoreDNS `plugin.cfg` (confirms `etcd` plugin still compiled in) —
  <https://github.com/coredns/coredns/blob/master/plugin.cfg>
- CoreDNS official Helm chart README (three deployment modes, `etcd-operator` dependency for federation
  mode) — <https://github.com/coredns/helm/blob/master/charts/coredns/README.md>
- `coreos/etcd-operator` GitHub API metadata (archived, last pushed 2020-04-03) —
  <https://api.github.com/repos/coreos/etcd-operator>
- `etcd-io/etcd-operator` GitHub repo and README (young, unfilled Kubebuilder scaffold, two releases) —
  <https://github.com/etcd-io/etcd-operator>
- Bitnami `etcd` Helm chart README (Prerequisites, Parallel Pod Management Policy, Secure Images framing) —
  <https://github.com/bitnami/charts/blob/main/bitnami/etcd/README.md>
- UniFi ExternalDNS webhook README (current, `home-operations` org) —
  <https://github.com/home-operations/external-dns-unifi-webhook/blob/main/README.md>
- UniFi ExternalDNS webhook releases —
  <https://github.com/home-operations/external-dns-unifi-webhook/releases>
- GitHub API confirmation that `kashalls/external-dns-unifi-webhook` redirects to
  `home-operations/external-dns-unifi-webhook`
- Pi-hole `FTL` README ("FTLDNS *is* `dnsmasq` + Pi-hole's code") —
  <https://github.com/pi-hole/FTL/blob/master/README.md>
- Pi-hole `docker-pi-hole` README (official Docker image, `docker-compose.yml` only, no Kubernetes) —
  <https://github.com/pi-hole/docker-pi-hole/blob/master/README.md>
- Pi-hole upstream issue confirming v6 broke custom-dnsmasq wildcard config —
  <https://github.com/pi-hole/pi-hole/issues/5925>
- Pi-hole/AdGuard Home/Technitium/dnsweaver GitHub repo metadata (stars, archived status, push dates) via
  the GitHub API
- AdGuard Home Knowledge Base — "Configuration" (native `rewrites`/wildcard support) —
  <https://adguard-dns.io/kb/adguard-home/configuration/>
- AdGuard Home Knowledge Base — "Docker" (volumes, no Kubernetes mention) —
  <https://adguard-dns.io/kb/adguard-home/docker/>
- AdGuard Home ExternalDNS webhook —
  <https://github.com/muhlba91/external-dns-provider-adguard> (README + releases, fetched directly)
- Technitium DNS Server README (features list: wildcard sub-domain support, RFC 2136 dynamic updates,
  Docker image, no Kubernetes/Helm mention) —
  <https://github.com/TechnitiumSoftware/DnsServer/blob/master/README.md>
- Technitium `docker-compose.yml` (volumes, host-networking note for DHCP deployments) —
  <https://github.com/TechnitiumSoftware/DnsServer/blob/master/docker-compose.yml>
- Technitium HTTP API docs (`update`/`updateNetworkACL` zone options confirming RFC 2136 support with
  IP-ACL authorization) —
  <https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md>
- Community Technitium ExternalDNS webhooks —
  <https://github.com/roosmaa/external-dns-technitium-webhook>,
  <https://github.com/Bugs5382/external-dns-technitium-webhook>,
  <https://github.com/djr747/external-dns-technitium-webhook> (READMEs + GitHub metadata, fetched directly)
- `dnsweaver` README — <https://github.com/maxfield-allison/dnsweaver/blob/main/README.md>
- Ubiquiti Help Center — "Creating Virtual Networks (VLANs)" (per-network DHCP/DNS settings), as already
  cited by `docs/research/unifi-segmentation-research.md` —
  <https://help.ui.com/hc/en-us/articles/9761080275607-Creating-Virtual-Networks-VLANs>
- Repo-wide search for `LoadBalancer`/`MetalLB`/`externalIPs`/`hostNetwork` (this repo, main worktree, `rg`,
  performed during this research) confirming no load-balancer implementation is configured anywhere today

## What could not be verified / sources attempted but blocked

- **UniFi's per-network "custom upstream DNS server" DHCP setting** (the specific mechanism that would let
  UniFi hand out a dedicated resolver's IP via DHCP Option 6 while UniFi remains the DHCP server) was not
  independently re-confirmed via a direct primary-source fetch in this session — `help.ui.com` is
  Cloudflare-bot-gated for direct fetches from this environment, and targeted Wayback Machine snapshot
  attempts for the specific DHCP/DNS settings article returned `503`/no matching capture. The adjacent,
  already-cited "Creating Virtual Networks (VLANs)" article (fetched successfully by the prior
  `unifi-segmentation-research` research and re-cited here) confirms each network's configuration surface
  includes "DHCP scope... and DNS settings," which is consistent with this being supported, but the exact
  mechanism/article was not independently re-verified in this pass.
- **The ExternalDNS in-tree RFC2136 provider paired with Technitium's own RFC2136 endpoint** is inferred
  from each project's own documentation (ExternalDNS ships a generic RFC2136 client; Technitium documents
  RFC 2136 support with IP-ACL authorization) but no worked example, blog post, or GitHub issue describing
  this specific pairing in practice was found. Flagged in the Recommendation section as "prototype before
  relying on," not presented as a confirmed-working integration.
- **Whether AdGuard Home's or Technitium's `rewrites`/wildcard support is actually reachable through their
  respective ExternalDNS integrations** (the `muhlba91` webhook for AdGuard, or the hypothetical RFC2136
  path for Technitium) was reasoned about from each side's documented data model (AdGuard's Adblock-rule
  format and Technitium's zone/RFC2136 semantics both admit arbitrary owner names, including wildcard
  labels) rather than confirmed by directly creating a wildcard HTTPRoute hostname against a live instance
  of either — a live smoke test is recommended before this becomes a load-bearing part of any future
  decision.
