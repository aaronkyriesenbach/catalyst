# Cross-cluster observability-collector topology: agent-to-gateway, SPIFFE mTLS at an Istio waypoint

Status: accepted

[Decide cross-cluster observability-collector deployment mechanics
(#44)](https://github.com/aaronkyriesenbach/catalyst/issues/44) settles how ADR 0008's per-cluster
OpenTelemetry Collector gets deployed onto the External and Internal workload clusters, and how it
reaches the platform cluster's VictoriaMetrics/VictoriaLogs/VictoriaTraces stores across the
cluster boundary.

## Decision

**Topology: OpenTelemetry's official agent-to-gateway pattern**, not a bare DaemonSet. Each workload
cluster runs:

- A **DaemonSet agent** (one Collector pod per node) receiving app-emitted OTLP locally and actively
  scraping that node's own signals (`kubeletstats`/`hostmetrics` receivers), plus a locally-run
  `kube-state-metrics` Deployment scraped the same way — giving each workload cluster real
  node/pod-health visibility, not just app telemetry passthrough. (Centralizing `kube-state-metrics`
  scraping on the platform cluster instead was rejected: it would need live Kubernetes-API reach into
  each workload cluster, which today only exists through Omni's WireGuard-tunneled proxy — the exact
  dependency ADR 0014 deliberately steered `join_token` node attestation away from.)
- A small **gateway Deployment** (1-2 replicas) that every DaemonSet agent forwards to over the
  in-cluster network (already secured for free by Istio ambient's intra-cluster mTLS, ADR 0009) — the
  only component that makes the actual cross-cluster hop.

Per OpenTelemetry's own [agent-to-gateway pattern
docs](https://opentelemetry.io/docs/collector/deploy/other/agent-to-gateway/), this pattern earns its
complexity specifically when the deployment needs **network isolation** ("your applications run in a
restricted network environment where only specific egress points can communicate with external
backends") and **host-specific metrics** — both apply here (no shared mesh across clusters per ADR
0009; `kubeletstats`/`kube-state-metrics` scraping is in scope). The docs' own "simpler patterns work
better" criteria (no host metrics needed, no restricted egress) don't hold for this deployment. The
gateway is also where the persistent (`file_storage`-backed, bounded) retry queue lives, absorbing a
platform-cluster or Management-host outage without dropping telemetry — one queue per cluster, not one
per node.

**Endpoint addressing**: ordinary internal `HTTPRoute` hostnames on the platform cluster's Istio
Gateway, reachable over the plain LAN path — mirroring [#49](https://github.com/aaronkyriesenbach/catalyst/issues/49)'s
OpenBao precedent (no dedicated LoadBalancer, since this traffic is HTTP, not CNPG's raw-TCP case).

**Authentication: SPIFFE mTLS, enforced at an Istio waypoint, not inside the VictoriaMetrics stack.**
Confirmed against VictoriaMetrics's own docs: `vminsert`/`vlinsert`/`vtinsert` have no built-in auth at
all, and the documented fronting mechanism (`VMAuth`) supports only **static** Basic Auth or Bearer
Token — a literal string comparison, with no JWT/JWKS/mTLS-client-cert validation capability. A
rotating SPIFFE JWT-SVID handed to `VMAuth` as a "bearer token" would simply stop matching on the next
rotation; VMAuth cannot validate SPIFFE identity in any form. So the cross-cluster gateway Collector's
X.509-SVID is validated as **mutual TLS at an Istio waypoint** in front of the VM ingestion Services
(one shared waypoint for all three stores — same caller, same policy, unlike #45's per-app waypoints
where the allowed-caller set genuinely differs per app), with an `AuthorizationPolicy` checking
`source.principals` against each originating cluster's expected SPIFFE ID. The `HTTPRoute` targets
`vminsert`/`vlinsert`/`vtinsert` directly (or, if the `victoria-metrics-k8s-stack` chart's default
topology already fronts them with a shared `VMAuth`, that specific write path is configured via
`VMAuth`'s own `unauthorizedUserAccessSpec` — a redundant static secret on top of a real mTLS identity
check would add a second, weaker credential to rotate for no security benefit).

**Deployment mechanism**: an ordinary ArgoCD `Application` per workload cluster, targeted via
[#42](https://github.com/aaronkyriesenbach/catalyst/issues/42)/ADR 0011's directory-placement
convention — no special-case needed.

**Explicitly deferred to [#61](https://github.com/aaronkyriesenbach/catalyst/issues/61)**: the actual
mechanics of distributing the SPIRE trust bundle so the platform cluster's waypoint can validate an
inbound client cert, and so a workload cluster can validate the platform's server cert on the same
connection — #61 already names this exact consumer in its own scope. This ADR fixes the
_mechanism_ (SPIFFE mTLS at a waypoint); #61 fixes the _trust-bundle wiring_.

## Considered Options

- **Bare DaemonSet, no gateway tier** — rejected per OpenTelemetry's own guidance above: this
  deployment needs both host-metrics collection and a restricted cross-cluster egress boundary, the two
  conditions the docs cite for preferring agent-to-gateway over a simpler DaemonSet-only setup. A bare
  DaemonSet would also mean every node's pod independently holds cross-cluster credentials and makes
  its own cross-cluster connections/retries — a much larger auth surface and connection-churn cost than
  one gateway per cluster.
- **VMAuth-native auth (Basic Auth/Bearer Token) for the cross-cluster write path** — rejected: not
  capable of validating a SPIFFE identity at all (static string comparison only), which was a hard
  requirement for this decision.
- **mTLS/SPIFFE termination at the shared ingress Gateway** (the one #47 is designing) instead of a
  dedicated waypoint — rejected, mirroring ADR 0013's (#45) own reasoning: keep per-service auth
  configuration self-contained rather than piling onto the one Gateway resource every app's traffic
  passes through.
- **Centralizing `kube-state-metrics` scraping on the platform cluster** — rejected: requires live
  cross-cluster Kubernetes-API reach, only available through Omni's WireGuard-tunneled proxy — the
  dependency ADR 0014 is deliberately avoiding for this class of traffic.

## Consequences

- Each workload cluster gains one new gateway Deployment + a locally-run `kube-state-metrics`, on top
  of the DaemonSet agent already implied by ADR 0008.
- The platform cluster needs a shared Istio waypoint in front of the three VM ingestion Services, plus
  per-cluster SPIFFE registration entries for each workload cluster's gateway Collector.
- Full end-to-end trust-bundle wiring (how the waypoint gets the SPIRE CA material, how a workload
  cluster validates the platform's server cert) is not yet decided — tracked on
  [#61](https://github.com/aaronkyriesenbach/catalyst/issues/61).
- Whether the `victoria-metrics-k8s-stack` chart already fronts `vminsert`/`vlinsert`/`vtinsert` with a
  default `VMAuth` (determining whether the write path bypasses `VMAuth` entirely or uses its
  `unauthorizedUserAccessSpec` escape hatch) is unconfirmed — verify during implementation planning.
