# Remote-access tunnel deployment topology: one Cloudflare Tunnel per cluster

Status: accepted

[Decide remote-access tunnel deployment topology across clusters (#48)](https://github.com/aaronkyriesenbach/catalyst/issues/48)
settles how Cloudflare Tunnel (#19) is actually deployed across the 3-cluster topology, now that
[#47](https://github.com/aaronkyriesenbach/catalyst/issues/47)/ADR 0016 gives every cluster its own
stable, LAN-reachable kube-vip VIP and exactly one Istio Gateway.

## Decision

**One Cloudflare Tunnel object per cluster (3 total: platform, External workload, Internal
workload)**, each an ordinary GitOps-hub-managed app, targeted per-cluster via #42's existing
directory-placement mechanism. Each Tunnel's ingress rules target *only that cluster's own* Istio
Gateway Service via plain in-cluster Service DNS (Host-header-routed, one rule per hostname, all
resolving to the same in-cluster Gateway Service) — never a VIP, never another cluster's network.

- **External workload cluster's Tunnel**: public hostnames only. Per ADR 0003 the External cluster
  holds *every* externally-reachable app and nothing internal-only, so its own apps' remote-access
  path is already the public hostname — no separate private/reach-in hostname needed for them.
- **Internal workload cluster's Tunnel**: private, Access-gated hostnames for its own apps (#19's
  reach-in mechanism) — this cluster's whole reason to exist per ADR 0003.
- **Platform cluster's Tunnel**: private, Access-gated hostnames for its own admin-style UIs
  (Grafana, ArgoCD, OpenBao, Zot, etc.) — the "platform-cluster-only UIs" case #19's resolution
  called out.

**Credentials**: 3 separate Cloudflare Tunnel tokens, each an ordinary app-layer secret sourced via
that cluster's own local ESO/OpenBao pull (#49) — no new secrets pattern needed.

**Cross-cluster app migration (#31)**: an app's Cloudflare-side hostname binding moves from one
cluster's Tunnel ingress config to another's when the app itself moves — this falls out of the
render pipeline the same way `external-dns`'s per-cluster ownership already does (ADR 0016), not a
hand-maintained side table.

## Considered Options

- **One centralized Tunnel, routed by per-cluster VIP or hostname** — rejected for the same reason
  ADR 0016 rejected a centralized `external-dns`: "each cluster hosts a disjoint app set," so there's
  no identified benefit to a cross-cluster dependency. It would also either hand-maintain a
  VIP-to-hostname map that can drift during #31's migration, or lean on resolving
  `*.int.lab53.net` from a cluster other than the one UniFi serves it to — a new, unestablished
  cross-cluster DNS-resolution dependency this design otherwise avoids everywhere else (SPIRE
  `join_token`, per-cluster ESO pull, per-cluster kube-vip).
- **Hybrid — public Tunnel on the External cluster + one shared reach-in Tunnel for Internal +
  platform** — considered, not adopted: only halves the credential count (2 instead of 3) at the
  cost of reintroducing the same cross-cluster-dependency problem for the shared half, for a
  marginal saving not worth the exception to an otherwise-consistent per-cluster pattern.

## Consequences

- The "exact Service/namespace each tunnel's ingress rule targets" question this ticket also posed
  resolves directly: each cluster's own Istio Gateway Service, already established by ADR 0009/#36 —
  no further design judgment needed, exact resource name is implementation-planning work.
- Exact placement of the `apps/traefik/externalApps.config.ts`-style admin-UI proxies (UniFi/TrueNAS/
  Proxmox) across the 3-cluster topology is a separate, not-yet-ticketed question — whichever
  cluster ends up hosting them, that cluster's own Tunnel picks up their hostnames automatically,
  per this design.
