# Multi-cluster ingress routing: per-cluster kube-vip, one Gateway per cluster, Cloudflare-hosted public DNS

Status: accepted

[Decide how traffic reaches the correct cluster across the multi-cluster ingress topology
(#47)](https://github.com/aaronkyriesenbach/catalyst/issues/47) settles how a request for a given
app actually reaches the _cluster_ that hosts it — platform, External workload, or Internal
workload — before that cluster's own Istio Gateway (ADR 0009) takes over.

## Decision

**IP assignment**: kube-vip's existing DaemonSet+ARP pattern, replicated independently on all
three clusters — informed by [Research: LoadBalancer implementation for exposing per-cluster
Gateway Services on Talos (#46)](https://github.com/aaronkyriesenbach/catalyst/issues/46), which
found the pattern carries over to Talos unchanged (already in the PSA-exempt `kube-system`
namespace) and found no compelling case for MetalLB. Each cluster gets its own kube-vip DaemonSet
advertising its own cluster's Gateway Service VIP — one VIP per cluster (see the Gateway-topology
correction below for why this is 3, not 4). All VIPs are hand-drawn from the same flat Infra VLAN
`10.53.40.0/24` (#5) since kube-vip's control-plane role is superseded entirely by Omni (#46's
finding), leaving Service-LB as kube-vip's only remaining job here.

**VIP-collision avoidance**: the 3 VIP assignments are codified as a single shared TypeScript
constants object (one entry per cluster), drawn from a reserved sub-block of `10.53.40.0/24`, that
every cluster's kube-vip config and Gateway Service annotation reference — rather than each being
hand-typed per cluster directory. This mirrors this repo's existing single-source-of-truth
conventions (e.g. #5's own IPAM numbering scheme) without standing up real IPAM machinery, which
would be disproportionate for 3 static IPs in a single-operator homelab.

**Bootstrap ordering / placement**: kube-vip is deployed as an ordinary GitOps-hub-managed app, per
cluster — the same placement ADR 0009 already gives Istio. ArgoCD reaches every cluster through
Omni's own WireGuard-tunneled proxy (ADR 0011) regardless of whether a Service VIP exists yet, so
there is no chicken-and-egg forcing kube-vip into cluster-bootstrap (Talos machine config) or
Omni's manifest-sync feature — both remain unused options unless a future need forces
cluster-bootstrap-time installation.

**Correction to ADR 0009 — one Gateway per cluster, not two**: ADR 0009 gave the External workload
cluster both an internal and an external `Gateway`, specifically to avoid a NAT hairpin for LAN
clients hitting a publicly port-forwarded IP. [Decide remote-access/tunnel approach
(#19)](https://github.com/aaronkyriesenbach/catalyst/issues/19) has since adopted Cloudflare Tunnel
for all reach-in, retiring router port-forwarding entirely — `cloudflared` opens an _outbound_
connection from inside the cluster to Cloudflare's edge, so there is no public IP and no hairpin to
avoid. The External workload cluster's existing internal Gateway already carries an `https-ext`
listener for non-`.int` hostnames (serving LAN clients for externally-accessible apps today), so
`cloudflared`'s ingress rule for a public hostname can point at that same, already-existing Gateway
Service. The separate external-facing `Gateway`, its dedicated VIP, and the router port-forward it
existed to serve are now redundant and dropped. **Every cluster runs exactly one Gateway.**

**`external-dns` multi-cluster topology**: one `external-dns-int` instance per cluster, each
watching only its own local cluster's `Gateway`/`HTTPRoute` API (no cross-cluster auth needed) with
its own distinct `txtOwnerId`, rather than a single centralized instance requiring #42's
cross-cluster auth mechanism for no identified benefit. `external-dns-ext` runs only on the External
workload cluster — the only cluster that ever holds public DNS-facing apps (ADR 0003). As apps
migrate clusters during the incremental cutover (#31), each cluster's `external-dns-int` instance's
existing `policy: sync` behavior automatically prunes stale records and creates new ones wherever an
app's `HTTPRoute` now actually lives — no new mechanism beyond today's behavior, just replicated
per-cluster with distinct ownership.

**Correction to [Decide DNS approach (#15)](https://github.com/aaronkyriesenbach/catalyst/issues/15)
— public zone moves to Cloudflare-hosted DNS**: #15 kept `lab53.net`'s public records on Route53,
reasoning the zone was already there at trivial cost with no functional gain from moving it. Tunnel
introduces a functional requirement #15 never weighed: [Research: Cloudflare Tunnel DNS-record
provisioning mechanics for a Route53-hosted zone (#53)](https://github.com/aaronkyriesenbach/catalyst/issues/53)
found no free mechanism that leaves `lab53.net` sitting authoritative at Route53 — Cloudflare's
Tunnel/Access routing needs zone-level knowledge of the hostname, and the one option that provides
that without moving the zone (CNAME/Partial Setup) is gated to Cloudflare's Business/Enterprise plan
(confirmed against Cloudflare's own docs: $200–250/mo), far outside this map's "cheap is fine with
justification" standing preference.

**Adopted: full NS delegation of `lab53.net` to Cloudflare** (DNS _hosting_ only — the domain stays
registered through Route 53 Domains; only the nameserver delegation moves). Free, and — critically —
preserves the exact existing hostname shape: `service.lab53.net` keeps working unchanged via
Cloudflare's native Tunnel CNAME routing, and `service.int.lab53.net` is **entirely unaffected**,
since internal DNS is UniFi's own local resolver (#15's other half), never part of the Route53 zone
in the first place. This correction is scoped strictly to the public-facing DNS _host_ — #15's
internal-DNS decision (keep UniFi) stands untouched.

Considered and rejected: delegating only a dedicated subdomain (e.g. `ext.lab53.net`) to
Cloudflare — also free and would avoid touching the root zone's provider, but forces every
externally-reachable app's hostname to change shape, which the full-zone delegation avoids
entirely for the same cost (free).

## Consequences

- `apps/traefik/gateway.ts`'s `externalGateway` (`traefik-external`, to become `istio-external`) is
  removed; its listeners' hostnames are already served by the surviving internal Gateway.
- `ddns-route53` and the `home.lab53.net` A-record are retired — dead weight once port-forwarding is
  gone (per #19), not previously threaded through to `external-dns.ts`.
- `external-dns-ext`'s provider switches from the in-tree AWS/Route53 provider to Cloudflare's
  provider; `apps/cert-manager/issuers.ts`'s ACME DNS-01 solver switches from `route53` to
  `cloudflare` (cert-manager has a native Cloudflare DNS-01 solver — a swap, not new capability).
- A Cloudflare API token becomes a new app-layer secret, sourced via OpenBao/ESO like every other
  app-layer credential (ADR 0004) — not a bootstrap-layer (AWS Secrets Manager) secret, since
  `external-dns`/`cert-manager` are ordinary GitOps-hub apps, not part of the bootstrap layer (ADR
  0001).
- The existing `aws-credentials`/`route53-creds` secrets and their IAM user (`irsa.md` §4.1/§4.3)
  are retired once the swap lands.
- [Decide remote-access tunnel deployment topology across clusters (#48)](https://github.com/aaronkyriesenbach/catalyst/issues/48)
  and [Decide cross-cluster TLS trust mechanism (#61)](https://github.com/aaronkyriesenbach/catalyst/issues/61),
  both natively blocked on this ticket, are now unblocked.
- The map's "LoadBalancer/MetalLB implementation" fog entry is fully resolved by this decision
  (kube-vip, replicated per cluster) and removed from fog.
- The map's "Dedicated internal DNS backend" fog entry's LoadBalancer prerequisite is now satisfied
  (kube-vip) should that fog entry ever graduate into a ticket.
- Exact migration mechanics (Cloudflare zone onboarding, NS cutover sequencing/TTLs, the
  `external-dns`/cert-manager config swap itself) are implementation-planning work, not further
  architecture — no design judgment remains, per this map's own destination (design locked, not
  executed here).

## Considered Options

- **MetalLB instead of kube-vip** — rejected per #46's research: same underlying L2/ARP mechanism as
  kube-vip's existing mode, kube-vip already has an equivalent BGP mode, and MetalLB carries a
  confirmed Talos-specific PSA cost (its default `metallb-system` namespace isn't PSA-exempt)
  kube-vip doesn't have in `kube-system`.
- **kube-vip/Talos-native-VIP for the control-plane role** — moot: self-hosted Omni (#7) already
  owns the control-plane endpoint and its config-override reference forbids a competing VIP.
- **Centralized `external-dns`** watching all 3 clusters remotely — rejected: would require reusing
  #42's cross-cluster auth mechanism for a benefit not identified, since each cluster hosts a
  disjoint app set.
- **Keep the External workload cluster's second (external-facing) Gateway** — rejected once
  Cloudflare Tunnel eliminated the NAT-hairpin rationale that justified it in ADR 0009; keeping it
  would mean maintaining a redundant Gateway, VIP, and DNS target for no remaining purpose.
- **Partial (CNAME) Setup, keep Route53 authoritative** — rejected on cost ($200–250/mo Cloudflare
  Business/Enterprise, confirmed against Cloudflare's own docs) — far outside this map's
  free-tier-first standing preference.
- **Delegate only a dedicated subdomain to Cloudflare** (e.g. `ext.lab53.net`) — rejected: also free,
  but forces a hostname-shape change for every externally-reachable app that full-zone delegation
  avoids at the same cost.
- **Reopen #19 to keep port-forwarding for the public path only** — considered, not adopted: would
  restore the very inbound-exposure surface #19 deliberately eliminated, just to dodge a DNS-hosting
  tradeoff that has a strictly-free resolution available (full delegation) once the domain-stays-in-AWS
  constraint is relaxed.
