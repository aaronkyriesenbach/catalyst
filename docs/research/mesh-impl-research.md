# Research: Service Mesh Implementation Options

**Ticket**: [#20](https://github.com/aaronkyriesenbach/catalyst/issues/20) — part of the
["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: Adopting a mesh for mTLS is already decided
([#33, closed](https://github.com/aaronkyriesenbach/catalyst/issues/33)) — explicitly for
hands-on learning value, not operational necessity. This document surveys *which*
implementation fits a small (2 nodes today, growing) k3s homelab, given:

- k3s cluster, currently 2 server nodes, expected to grow (see `cluster/README.md`, which
  describes a 3-node target for etcd quorum)
- Ingress/gateway layer is k3s's bundled Traefik, configured via the Kubernetes **Gateway
  API** (not the classic Ingress or Traefik's `IngressRoute` CRD) — see `apps/traefik.ts`,
  `apps/traefik/gateway.ts`, `cluster/traefik-config.yaml`
- No CNI override currently in the repo — k3s's default CNI (Flannel) is in use; nothing in
  `cluster/` or `apps/` swaps it for Cilium or Calico
- Single operator, free-tier-first, resource footprint matters at small node counts

All claims below are cited to the owning project's own documentation/source, fetched directly
(not secondary blog posts).

---

## Istio

### Two data-plane modes

Istio has two deployment modes for its data plane, both driven by the same control plane
(`istiod`):

- **Sidecar mode** — an Envoy proxy container is injected into every meshed pod; mediates
  all in/out traffic for that pod and does mTLS, routing, and telemetry.
  [Istio Architecture docs](https://istio.io/latest/docs/ops/deployment/architecture/)
- **Ambient mode** ("sidecar-less mesh") — a per-node L4 proxy (`ztunnel`, written in Rust)
  handles secure-overlay mTLS/auth/telemetry for every pod on the node with no sidecar and no
  pod restarts; an optional per-namespace L7 **waypoint proxy** (Envoy) is added only where L7
  features (routing, L7 authz) are needed. Ztunnel and waypoints are separate, independently
  scaled components — not baked into the CNI or application pods.
  [Istio Ambient Overview](https://istio.io/latest/docs/ambient/overview/)

### Resource footprint

- `istiod` (control plane, single replica by default): request `cpu: 500m`, `memory: 2048Mi`.
  [`istio-discovery` Helm chart `values.yaml`](https://raw.githubusercontent.com/istio/istio/master/manifests/charts/istio-control/istio-discovery/values.yaml)
- `ztunnel` (ambient per-node DaemonSet): request `cpu: 200m`, `memory: 512Mi` by default —
  the chart comment notes this default is "enough for ~200k pod cluster or 100k concurrently
  open connections," i.e. explicitly oversized for a homelab and reducible.
  [`ztunnel` Helm chart `values.yaml`](https://raw.githubusercontent.com/istio/istio/master/manifests/charts/ztunnel/values.yaml)
- Sidecar mode adds an Envoy container (with its own CPU/memory) to **every** meshed pod,
  which multiplies with workload count. Ambient mode's ztunnel is per-**node**, not per-pod,
  so it scales with node count (2, growing) rather than workload count — a materially better
  fit for a small/growing footprint.

### Learning curve

Istio is the most feature-rich and most complex of the three: full CRD-based traffic
management API (`VirtualService`, `DestinationRule`, `PeerAuthentication`, etc.), Kiali/
Prometheus/Grafana/Jaeger addon stack for observability, and both data-plane modes to
understand. The [Getting Started guide](https://istio.io/latest/docs/setup/getting-started/)
walks through `istioctl install`, sample app injection, and Gateway API-based ingress
(`Gateway`/`HTTPRoute`) end to end — Istio's own quickstart already assumes Gateway API,
not the legacy `Ingress` object.

### Traefik / Gateway API interop

- Istio's own ingress path in current docs *is* the Kubernetes Gateway API: "A minimal install
  of Istio can be used to provide a fully compliant implementation of the Kubernetes Gateway
  API for cluster ingress traffic control. For service mesh users, Istio also fully supports
  the GAMMA initiative's Gateway API support for east-west traffic management within the
  mesh." [Gateway API implementations page — Istio entry](https://gateway-api.sigs.k8s.io/implementations/)
  Istio is listed as **Conformant** for both the Gateway-controller profile and the
  Service-Mesh-implementation profile (GAMMA) — the only project other than Cilium with
  mesh-profile conformance.
- Ambient mode's interop model explicitly supports keeping an existing non-mesh ingress
  (i.e., leaving Traefik as-is, outside the mesh) while still getting the mesh's security
  guarantees: "An ingress gateway may run in a non-ambient namespace, and expose services
  provided by ambient mode, sidecar mode or non-mesh pods." A destination pod's ztunnel
  enforces `PeerAuthentication`/mTLS policy regardless of whether the caller (e.g. Traefik) is
  in the mesh. [Istio — Add workloads to the mesh](https://istio.io/latest/docs/ambient/usage/add-workloads/)
  This means Traefik does **not** need to be modified, meshed, or run a sidecar for ambient
  mode's mTLS to take effect between meshed backend pods — a much lower-friction interop story
  than sidecar mode, where the ingress pod itself would typically need injection.
- Istio can run alongside Traefik without replacing it: Istio's Gateway API support is only
  exercised if you choose to route ingress through an Istio-managed `Gateway`; otherwise
  Traefik continues to own north-south routing and Istio only handles east-west mesh traffic
  between already-meshed pods.

---

## Linkerd

### Architecture

Linkerd is control plane + data plane, sidecar-only (no ambient/sidecar-less mode exists).
The data plane is the `linkerd2-proxy`, an "ultralight, transparent micro-proxy written in
Rust," purpose-built for the mesh use case (explicitly *not* Envoy — Linkerd differentiates
itself from Istio on this point). The proxy is injected via a Kubernetes admission webhook
(`linkerd.io/inject: enabled` annotation) and intercepts traffic via `iptables` rules from an
init container or Linkerd's CNI plugin. The control plane's `identity` service acts as the mTLS
CA, issuing certs to proxies at injection time.
[Linkerd Architecture reference](https://linkerd.io/2.14/reference/architecture/)

### Resource footprint

- Non-HA installs do not set default CPU/memory requests on the control plane or proxies
  (they render as unset/empty in the Helm chart) — good for a minimal footprint, but High
  Availability (HA) mode is explicitly what turns on "production-ready CPU and memory resource
  requests on control plane components" and "on data plane proxies," runs 3 replicas of
  critical control-plane components, and requires pod anti-affinity across at least 3 nodes:
  "HA mode assumes there are always at least three nodes in the Kubernetes cluster. If this
  assumption is violated (e.g. the cluster is scaled down to two or fewer nodes), then the
  system may be left in a non-functional state." [Linkerd High Availability docs](https://linkerd.io/2.14/features/ha/)
  This is a direct, primary-source-documented mismatch with "2 nodes today" — non-HA mode is
  the correct fit for now, with HA becoming viable once the node count grows past 3.
- Every meshed pod gets its own proxy sidecar (no ambient/per-node option), so — like Istio
  sidecar mode — footprint scales with workload count, not node count.
- Per-proxy resource requests/limits are fully overridable via pod annotations
  (`config.linkerd.io/proxy-cpu-request`, `-memory-request`, etc.), so individual workloads can
  be tuned down for a small cluster. [Linkerd Proxy Configuration reference](https://linkerd.io/2.14/reference/proxy-configuration/)
- Prometheus sizing guidance for the (optional) Viz extension: "the usual guidance is 5MB per
  meshed pod" for retained timeseries — a small, calculable add-on cost for a homelab-scale
  pod count. [Linkerd HA docs](https://linkerd.io/2.14/features/ha/)

### Learning curve

Generally regarded (by its own docs' framing) as the simpler of the two full meshes: a single
`linkerd install`/CLI-driven flow, mTLS-by-default with no policy authoring required to get
basic mTLS working, and a narrower feature surface (no WASM extensibility, no separate
gateway-config CRDs to learn). Trade-off: fewer traffic-management primitives than Istio.

### Traefik / Gateway API interop

- Linkerd is **not a Gateway API *Gateway* controller** — it does not appear in the Gateway API
  implementations page's Gateway-controller conformance lists at all (only in the general
  ecosystem, and not under "Service Mesh Implementation Status: Conformant" either — that list
  contains only Istio and Cilium as of the current page).
  [Gateway API Implementations page](https://gateway-api.sigs.k8s.io/implementations/)
  Linkerd does, however, consume `HTTPRoute` resources (the upstream Gateway API kind) for
  its own **east-west** mesh traffic policy, attaching them to a `Service` or `Server` for
  outbound/inbound routing and authorization — this is Linkerd-internal traffic management,
  not north-south ingress. [Linkerd HTTPRoutes reference](https://linkerd.io/2.14/features/httproute/)
- Linkerd's ingress-interop documentation predates the Gateway API and is written in terms of
  the classic `Ingress` object or Traefik's own `IngressRoute`/`Middleware` CRDs (adding a
  `l5d-dst-override` header via a Traefik `Middleware`), requiring Traefik to run in Linkerd's
  special **ingress mode** (`linkerd.io/inject: ingress`) so Linkerd can do its own endpoint
  selection instead of Traefik's. [Linkerd — Handling ingress traffic](https://linkerd.io/2.14/tasks/using-ingress/)
  Since catalyst's Traefik is configured purely via Gateway API `Gateway`/`HTTPRoute`
  (`apps/traefik/gateway.ts`), not classic `Ingress` or Traefik's `IngressRoute` CRD, this
  specific documented recipe does not directly apply; adopting Linkerd would mean either (a)
  meshing the Traefik pod itself as a normal sidecar workload (simplest, but loses the
  header-based endpoint-selection optimization the ingress-mode docs describe) or (b) working
  out an equivalent Gateway API integration without a first-party documented recipe.
- Net effect: Linkerd + Gateway API + Traefik is a **less-documented combination** than
  Istio's, because Linkerd's own ingress guidance hasn't been updated for the Gateway API world
  and Linkerd doesn't implement the Gateway API `Gateway` resource itself.

---

## Cilium (Service Mesh / mTLS mode)

### Architecture

Cilium is fundamentally a CNI (eBPF-based networking/observability/security), with service
mesh capabilities layered on top of the same agent that provides pod networking — it supports
a **sidecar-less** mesh model by default (avoiding "the operational complexity of sidecars"),
though it can also do sidecar proxying. [Gateway API implementations page — Cilium entry](https://gateway-api.sigs.k8s.io/implementations/)

Cilium's **mutual authentication** feature (its mTLS story) is layered differently from
Istio/Linkerd: identity is provided via **SPIFFE/SPIRE** — a central SPIRE server (root of
trust) plus a per-node SPIRE agent that issues workload identities (SVIDs) on request. Cilium
agents can request identities on behalf of workloads. mTLS itself piggybacks on Cilium's
existing transparent encryption features (WireGuard or IPsec) rather than being a fully
independent mTLS handshake path.
[Cilium Mutual Authentication docs](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/)

### Maturity — important caveat

Cilium's own docs mark Mutual Authentication as **Beta** and list a substantial "Detailed
Roadmap Status" of incomplete items, including: integrating with WireGuard, per-connection
handshakes (currently coarser), syncing the ipcache with auth data, "Detailed documentation of
security model" (TODO), "Conduct penetration test of model" (TODO), and "Review maturity and
consider for stable" (TODO). It's also explicitly **not compatible with Cluster Mesh**
(multi-cluster) and "only works within a Cilium-managed cluster... not compatible with an
external mTLS solution." [Cilium Mutual Authentication docs](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/)
For a ticket whose explicit goal is hands-on mTLS/service-mesh *learning*, adopting a
still-incomplete security model with an unfinished threat model and no independent pen-test is
a materially different risk profile than Istio's or Linkerd's mTLS, which have been
production-hardened for years.

### Resource footprint / operational footprint

- Cilium's mesh/mTLS features are additive to Cilium as CNI, not a separate control plane —
  no per-pod sidecar tax and no separate mesh control-plane deployment beyond Cilium's own
  agent/operator plus an optional bundled SPIRE server (which itself wants a
  `PersistentVolumeClaim`, though it can be switched to in-memory storage for lab use via
  `authentication.mutual.spire.install.server.dataStorage.enabled=false`).
  [Cilium Mutual Authentication docs](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/)
- However, catalyst's cluster currently runs k3s's **default CNI (Flannel)** — nothing in
  `cluster/` or `apps/` indicates Cilium is already installed. Adopting Cilium's mesh mode
  therefore means **migrating the CNI itself**, a cluster-wide, higher-blast-radius change
  compared to layering Istio or Linkerd on top of the existing Flannel/Traefik stack. Cilium
  requires Linux kernel `>= 5.10` (or `4.18` on RHEL 8.10) and specific kernel eBPF config
  options (`CONFIG_BPF=y`, `CONFIG_BPF_SYSCALL=y`, etc.) — likely fine on modern Debian/Ubuntu
  nodes but worth confirming on the actual node OS/kernel before committing.
  [Cilium System Requirements](https://docs.cilium.io/en/stable/operations/system_requirements/)

### Learning curve

Cilium mesh mode teaches a different mental model than Istio/Linkerd (eBPF + eventual-
consistency identity via SPIFFE/SPIRE, vs. sidecar/ambient proxy architectures) — valuable if
the learning goal includes eBPF/CNI internals, less directly transferable if the goal is
mainstream "service mesh" concepts (Envoy/Linkerd-proxy traffic management, mTLS via a
dedicated mesh CA) that dominate the industry's service-mesh vocabulary.

### Traefik / Gateway API interop

- Cilium is listed **Conformant** on the Gateway API implementations page for *both* the
  Gateway-controller profile and the Service-Mesh-implementation (GAMMA) profile — passing
  conformance for Gateway API v1.4.0 as of Cilium 1.19.
  [Gateway API Implementations page](https://gateway-api.sigs.k8s.io/implementations/)
- Because Cilium's mesh features operate at the CNI/eBPF layer, Traefik continues to work as
  the Gateway API `Gateway` controller unmodified — Cilium doesn't need to own ingress for its
  mTLS features to apply to east-west traffic between meshed pods. This is similar in spirit to
  Istio ambient mode's "leave the ingress alone" interop story.
- Note Cilium *also* ships its own Gateway API Gateway controller (usable as an alternative to
  Traefik), but nothing requires switching off Traefik to use Cilium's mesh/mTLS features.

---

## Comparison summary

| | Istio (ambient) | Istio (sidecar) | Linkerd | Cilium mesh (mTLS) |
|---|---|---|---|---|
| Per-workload sidecar tax | No (per-node ztunnel + optional per-namespace waypoint) | Yes | Yes | No |
| Scales with | Node count | Workload count | Workload count | Node count (already-running CNI agent) |
| Control plane footprint | `istiod`: 500m CPU / 2Gi mem (default, single replica) | same | Unset by default (non-HA); HA needs ≥3 nodes | Cilium agent/operator (already present if adopted as CNI) + optional SPIRE |
| mTLS maturity | Production, years of hardening | Production | Production | **Beta**, documented-incomplete security model |
| Gateway API mesh (GAMMA) conformance | Conformant | Conformant | Not listed as conformant mesh implementation | Conformant |
| Requires touching current CNI (Flannel) | No | No | No | **Yes — full CNI migration** |
| Requires meshing/modifying Traefik pod for mTLS to apply | No (ztunnel enforces at destination) | Typically yes (ingress meshed or in special mode) | Yes, and only via pre-Gateway-API `Ingress`/CRD recipes | No (Cilium enforces at network layer) |
| Fits "2 nodes today, growing" | Yes | Partially (works, but sidecar tax) | Yes for non-HA; HA explicitly wants ≥3 nodes | Yes, but at the cost of a CNI migration |

---

## Recommendation

**Istio in ambient mode** is the best fit for this homelab, on primary-source grounds:

1. **Resource footprint scales with node count (2, growing), not workload count.** Ztunnel is
   a per-node DaemonSet; no sidecar is added to every pod. This is the only option among the
   three that avoids both a per-pod tax (Istio sidecar, Linkerd) *and* a CNI migration
   (Cilium). [Istio Ambient Overview](https://istio.io/latest/docs/ambient/overview/)
2. **Lowest integration friction with the existing Traefik + Gateway API layer.** Ambient
   mode explicitly supports leaving an ingress controller un-meshed while still enforcing
   `PeerAuthentication`/mTLS at the destination ztunnel — no need to inject Traefik, run it in
   a special ingress mode, or write undocumented Gateway API glue. Istio is also
   GAMMA-conformant, so if the learning goal later expands to Gateway API-driven east-west
   traffic policy, that path is first-party supported.
   [Istio — Add workloads to the mesh](https://istio.io/latest/docs/ambient/usage/add-workloads/),
   [Gateway API Implementations page](https://gateway-api.sigs.k8s.io/implementations/)
3. **mTLS is production-hardened**, unlike Cilium's Beta mutual-authentication feature, whose
   own roadmap lists an incomplete security model and no independent security review yet —
   a meaningfully worse fit for a ticket whose stated purpose is *learning* mTLS/service-mesh
   concepts correctly, not experimenting with an admittedly unfinished implementation.
   [Cilium Mutual Authentication docs](https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/)
4. **No CNI migration required.** Adopting Cilium's mesh mode would mean replacing Flannel
   cluster-wide, a materially larger and riskier operational change for a 2-node (growing)
   single-operator cluster than layering Istio on top of the existing CNI/Traefik stack.
5. Ambient mode's control-plane cost (`istiod`: 500m CPU / 2Gi memory by default) is
   non-trivial for a 2-node cluster and should be tuned down from the chart defaults; this is
   a configuration exercise, not a blocker — sizing knobs exist in the Helm values.
   [`istio-discovery` `values.yaml`](https://raw.githubusercontent.com/istio/istio/master/manifests/charts/istio-control/istio-discovery/values.yaml)

**Linkerd** is the strongest runner-up if the priority shifts toward simplicity of the
control-plane/CLI experience over sidecar-less architecture — its non-HA footprint is genuinely
minimal — but its per-pod sidecar tax scales with workload count as the homelab grows, its HA
mode explicitly wants ≥3 nodes, and its Gateway API/Traefik interop story is the least
well-documented of the three (no first-party Gateway API ingress recipe, non-conformant as a
GAMMA mesh implementation).

**Cilium mesh mode** is not recommended as the primary choice at this time: its mTLS feature is
Beta with an admittedly incomplete security model, and adopting it means migrating the
cluster's CNI away from Flannel — a large, cluster-wide operational change to take on purely
for a "nice to have hands-on learning" mesh, when the CNI itself isn't otherwise a pain point
today. It remains worth a future look once (a) mutual authentication reaches stable, and/or (b)
there's an independent reason to move off Flannel (e.g., wanting eBPF-based network policy or
Hubble observability) that would justify the migration on its own merits.

---

## Sources

- Istio Architecture — https://istio.io/latest/docs/ops/deployment/architecture/
- Istio Ambient Overview — https://istio.io/latest/docs/ambient/overview/
- Istio — Add workloads to the mesh — https://istio.io/latest/docs/ambient/usage/add-workloads/
- Istio Getting Started — https://istio.io/latest/docs/setup/getting-started/
- Istio `istio-discovery` Helm chart values — https://raw.githubusercontent.com/istio/istio/master/manifests/charts/istio-control/istio-discovery/values.yaml
- Istio `ztunnel` Helm chart values — https://raw.githubusercontent.com/istio/istio/master/manifests/charts/ztunnel/values.yaml
- Linkerd Architecture reference — https://linkerd.io/2.14/reference/architecture/
- Linkerd High Availability — https://linkerd.io/2.14/features/ha/
- Linkerd Proxy Configuration reference — https://linkerd.io/2.14/reference/proxy-configuration/
- Linkerd HTTPRoutes — https://linkerd.io/2.14/features/httproute/
- Linkerd — Handling ingress traffic — https://linkerd.io/2.14/tasks/using-ingress/
- Cilium Mutual Authentication (Beta) — https://docs.cilium.io/en/stable/network/servicemesh/mutual-authentication/mutual-authentication/
- Cilium System Requirements — https://docs.cilium.io/en/stable/operations/system_requirements/
- Kubernetes Gateway API Implementations page — https://gateway-api.sigs.k8s.io/implementations/
- catalyst repo (for current-state context): `apps/traefik.ts`, `apps/traefik/gateway.ts`,
  `cluster/traefik-config.yaml`, `cluster/README.md`
