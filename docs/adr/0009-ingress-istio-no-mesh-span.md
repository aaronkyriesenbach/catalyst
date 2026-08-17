# Ingress/routing layer: Istio Gateway API, collapsed with the mesh; no cross-cluster mesh span

Status: accepted

**Replace Traefik with Istio** as the Gateway API implementation, across all three clusters (platform,
External workload, Internal workload) — collapsing the ingress/routing layer into the service mesh
already adopted in ADR 0002/#21 (Istio ambient mode), rather than keeping them as two separate
components. **The mesh does not span cluster boundaries**: each cluster runs its own independent Istio
install with its own root CA — no shared trust, no east-west gateway, no cross-cluster remote-secret
exchange.

## Context

The reverse-proxy/Gateway API research (#35) found no feature gap in Traefik against this repo's actual
usage, and initially recommended keeping Traefik and Istio as separate, independently-reversible
components — matching the reasoning that won the mesh-implementation decision (#21: Istio ambient chosen
specifically because it doesn't require touching Traefik). Re-litigating that framing surfaced a fact the
original research had left unconfirmed: whether Istio's own Gateway API ingress supports
`BackendTLSPolicy`, the one real feature this repo depends on for its non-cluster `ExternalApp` proxies
(UniFi/TrueNAS/Proxmox). Direct verification against Istio's own 1.28 release notes confirmed full
`BackendTLSPolicy` v1 support (plus `sectionName` port-scoping and `ServiceEntry` `targetRef` support) —
removing the one blocker that had ruled Istio out as a serious ingress candidate.

With that gap closed, collapsing ingress into Istio directly serves the mesh's own justification
(hands-on mTLS/service-mesh learning, #33 — not operational necessity) by giving one control plane more
combined surface to operate, rather than splitting that learning across two systems.

Separately, ADR 0003 partitions workload clusters by trust boundary and gives cluster-boundary
blast-radius containment as an explicit (bonus) benefit. Whether the mesh should span all three clusters
for cross-cluster mTLS was evaluated against the one concrete cross-cluster traffic case that exists:
CloudNativePG (ADR 0006) means every workload-cluster app crosses the network to reach Postgres on the
platform cluster. Spanning the mesh would secure that path with transparent, automatic mTLS; not spanning
leaves it to CNPG's own cert-manager-issued TLS — a standard, adequate mechanism that
[#40](https://github.com/aaronkyriesenbach/catalyst/issues/40) has to configure regardless of this
decision (ADR 0006 already defers DB connection security to that ticket). Spanning's only genuine
advantage is insurance against _future_, currently non-existent cross-cluster app-to-app traffic, at the
cost of a shared root CA across all three clusters — which cuts directly against ADR 0003's own
blast-radius-containment rationale, plus an east-west gateway that would need to be exposed without any
LoadBalancer implementation in this repo (MetalLB is undecided fog) and a cross-cluster remote-secret
exchange between every cluster's istiod and every other cluster's API server.

## Decision

- **Istio replaces Traefik** as the Gateway API implementation on all three clusters.
- **Installed via the GitOps hub** (ArgoCD, ADR 0007) as an ordinary per-cluster app, not via
  cluster-bootstrap (Omni/Talos). This repo's stack has no mechanism for installing Kubernetes-level
  workloads at cluster-creation time — Omni's role is strictly machine-level (Talos config,
  `systemExtensions`) — and ambient Istio doesn't gate basic cluster function the way a CNI would (that
  absence of a hard CNI dependency is _why_ it was chosen over Cilium in #21), so there's no real
  alternative mechanism to weigh against the hub.
- **Gateway topology is unchanged**: platform cluster and Internal workload cluster each run an
  internal-only `Gateway`; External workload cluster runs both internal and external `Gateway`s — the
  latter needed because every externally-reachable app must also be reachable directly from the LAN via
  split-horizon DNS (#15), avoiding a NAT hairpin through the public internet-facing path.
- **The mesh does not span cluster boundaries.** Independent per-cluster Istio installs, independent root
  CAs, no east-west gateway. Cross-cluster Postgres traffic security is CNPG-native TLS, owned entirely by
  [#40](https://github.com/aaronkyriesenbach/catalyst/issues/40).
- **TLS termination carries over unchanged**: `certificateRefs`/`Secret`-based termination is core Gateway
  API, not Traefik-specific. `cert-manager`'s existing `Certificate`/`ClusterIssuer` setup
  (`apps/traefik/certs.ts`) is untouched; only the `Gateway` resources' `gatewayClassName` changes from
  `traefik` to `istio`.
- **Multi-cluster app-targeting mechanics** (how the same Istio install actually gets stamped onto every
  registered cluster) are not decided here — reuses whatever
  [#42](https://github.com/aaronkyriesenbach/catalyst/issues/42) picks (`ApplicationSet` Cluster generator
  vs. an explicit `AppConfig` field), the same dependency
  [#44](https://github.com/aaronkyriesenbach/catalyst/issues/44) (the OpenTelemetry Collector's identical
  per-cluster rollout question) already carries.

## Considered Options

- **Keep Traefik, Istio separate** — the research's original recommendation, rejected once Istio's
  `BackendTLSPolicy` gap was confirmed closed: it no longer has a demonstrated feature deficit, and
  keeping two components active serves the mesh's learning goal less than collapsing them does.
- **Cilium** (both CNI + ingress + mesh) — rejected: forces a cluster-wide kube-proxy-replacement/CNI
  migration this decision shouldn't have to carry, and would reopen the already-closed mesh decision
  (#21 picked Istio over Cilium specifically for mTLS maturity).
- **Envoy Gateway / NGINX Gateway Fabric / kgateway** (ingress-only alternatives) — rejected: no
  demonstrated advantage over Traefik for this repo's actual usage, so adopting any of them would be a
  real migration cost (OIDC re-implementation, route retargeting) for zero functional gain. Not
  Mesh/GAMMA-conformant, so none of them collapse with the mesh the way Istio does.
- **HAProxy Ingress** — ruled out outright: no `BackendTLSPolicy` support, a hard regression against
  current usage.
- **Span the mesh across all 3 clusters** — rejected: the one motivating case (cross-cluster DB traffic)
  already has an adequate fix at a different layer (#40's CNPG-native TLS) that has to exist regardless;
  spanning's only real benefit is insurance against speculative future cross-cluster app-to-app traffic,
  at the cost of a shared trust domain that weakens ADR 0003's blast-radius-containment rationale, plus a
  cross-cluster east-west gateway this repo has no LoadBalancer implementation to expose.
- **Cluster-bootstrap installation** (Omni-side) — rejected: no such mechanism exists in this repo's
  stack for Kubernetes-level workloads, and ambient Istio's whole selling point is not needing to exist
  before the cluster is otherwise usable.

## Consequences

- Every existing `HTTPRoute`/`Gateway` in `apps/traefik/*` needs retargeting from the `traefik`
  `GatewayClass` to `istio`; `cert-manager`'s `Certificate`/`ClusterIssuer` setup is untouched.
- OIDC forward-auth (`docs/forward-auth.md`, `withOidcAuth({ middleware: true })`) has no Istio
  equivalent to Traefik's plugin+`Middleware` shape — Istio's documented pattern is an
  `AuthorizationPolicy` with `action: CUSTOM` delegating to an external authorizer (e.g. `oauth2-proxy`),
  which in ambient mode requires a waypoint proxy per protected app. Reimplementation mechanics (which
  authorizer, waypoint deployment shape, `AuthorizationPolicy`/`utils.ts` wiring), plus the pre-existing
  Lab(Infra)→Management OIDC gap, are split into a new follow-on ticket rather than decided here.
- #40 (DBaaS provisioning/connectivity mechanics) now definitively owns cross-cluster Postgres transport
  security (CNPG-native TLS) — the mesh will not provide it.
- #42's `ApplicationSet`-vs-`AppConfig`-field decision now has a third concrete consumer (Istio, alongside
  the GitOps hub's own targeting and #44's OpenTelemetry Collector rollout).
