# Research: Reverse-Proxy / Gateway API Implementation Options

**Ticket**: [#35](https://github.com/aaronkyriesenbach/catalyst/issues/35) — blocks
[#36, "Decide the ingress/routing-layer implementation and its architectural
placement"](https://github.com/aaronkyriesenbach/catalyst/issues/36) — part of the
["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: This repo runs Traefik today purely because k3s bundles it by default
(`cluster/traefik-config.yaml`, `docs.k3s.io` — see below), not because it was deliberately
chosen. The k8s-distro/cluster-lifecycle decision itself is still open
([#7](https://github.com/aaronkyriesenbach/catalyst/issues/7)), so this research treats "which
Gateway API implementation" as **independent of k3s** — every option below is evaluated as
something that could be installed on any conformant Kubernetes distribution, with k3s-specific
notes (like the one-flag `--disable=traefik`) called out only where they matter operationally.
This document does not decide anything; it surveys options and their tradeoffs for the grilling
ticket (#36) to consume. All claims are cited to the owning project's own docs, the official
Gateway API project, NIST, k3s's own docs, or this repo's own code — fetched directly, not
secondary write-ups.

---

## Current usage in this repo (the baseline every option is compared against)

- **Internal/external Gateway split**: two `Gateway` resources, `traefik-internal` and
  `traefik-external`, both `gatewayClassName: traefik`. `traefik-internal` listens on both
  `*.int.lab53.net` and `*.lab53.net`; `traefik-external` listens only on `*.lab53.net`.
  `external-dns` resolves the same `*.lab53.net` hostnames differently depending on whether a
  client is asking the internal (UniFi) or external (Route53) DNS view — a split-horizon pattern,
  per the map's current-state snapshot ("external-dns split internal (Unifi)/external (Route53)",
  [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).
  [`apps/traefik/gateway.ts`]
- **`HTTPRoute`**: every app's route is built by `buildRoute()` in `utils.ts`, which sets
  `parentRefs` to either just `traefik-internal`, or both `traefik-internal` and
  `traefik-external` when `externallyAccessible: true` is passed. [`utils.ts`, `apps/traefik/routes.ts`]
- **`BackendTLSPolicy`** (GA, `gateway.networking.k8s.io/v1`, standard channel since Gateway API
  v1.4.0 — [Gateway API `BackendTLSPolicy` reference](https://gateway-api.sigs.k8s.io/reference/api-types/policy/backendtlspolicy/)):
  used to validate the backend TLS certificate served by non-cluster admin planes (UniFi,
  TrueNAS, Proxmox) against an internal root CA bundle. **Hand-typed** in `types.ts` because
  `@kubernetes-models/gateway-api@^0.7.4` (the version pinned in `package.json`) doesn't cover it
  — confirmed in this repo's own `AGENTS.md`: _"Hand-roll types only when no package provides
  them (e.g. `HelmChart` for `helm.cattle.io/v1`, `BackendTLSPolicy` for the GA
  `gateway.networking.k8s.io/v1` API that the package hasn't caught up to yet)."_ This is a
  **repo-tooling gap, not an implementation gap** — it exists regardless of which Gateway API
  implementation is chosen, so it shouldn't factor into the implementation decision itself (see
  "Feature parity" below for why it might still narrow the field on the implementation side).
  [`types.ts`, `AGENTS.md`, `package.json`]
- **Implementation-specific extension already in use**: OIDC forward-auth
  (`docs/forward-auth.md`) is wired in via an `HTTPRoute` `ExtensionRef` filter pointing at a
  `traefik.io` `Middleware` CRD (`utils.ts`'s `buildRoute()`, `forwardAuth` option). `ExtensionRef`
  filters are Gateway API's own designed escape hatch for implementation-specific behavior — by
  spec, they are **not portable**. Switching Gateway API implementations means re-implementing
  OIDC forward-auth using whatever mechanism the new implementation offers (see "Feature parity"
  below — every mainstream option surveyed has _some_ first-party OIDC mechanism, but none of them
  are the same shape as Traefik's plugin+`Middleware` CRD). [`docs/forward-auth.md`, `utils.ts`]
- **Non-cluster admin-plane reverse proxying**: `apps/traefik/externalApps.config.ts` lists
  UniFi (`192.168.1.1:443`), TrueNAS (`192.168.53.120:443`), and Proxmox
  (`192.168.53.100/.101/.102:8006`) as `ExternalApp` entries. For each, `apps/traefik/externalApps.ts`
  generates an `EndpointSlice` pointing at the appliance's IP, a `Service`, a `BackendTLSPolicy`
  validating the appliance's cert against `internal-root-ca-bundle`, and an `HTTPRoute` built via
  `buildRoute(name, port, { subDomain })` — **note: this call does not pass
  `externallyAccessible: true`**, so per `appHostname()`/`buildRoute()`'s logic, these three
  routes currently get `*.int.lab53.net` hostnames and are attached only to the
  `traefik-internal` Gateway's `parentRefs`. **Correction to this ticket's framing**: as coded
  today, the UniFi/TrueNAS/Proxmox proxies are internal-only, not externally-accessible —
  several _other_ apps (`trilium.ts`, `immich.ts`, `open-webui.ts`, `jellyfin.ts`,
  `filebrowser-quantum.ts`, `poznote.ts`, `shakedown.ts`, `navidrome.ts`, `miniflux.ts`,
  `radicale.ts`, `forscore.ts`) do set `externallyAccessible: true` and so are attached to
  `traefik-external`. The substantive architectural point survives this correction, just
  reshaped: **the same Traefik deployment** — the same pods, the same node placement, the same
  network egress path — simultaneously (a) terminates traffic from the internet-facing
  `traefik-external` Gateway for the apps listed above, and (b) holds live `EndpointSlice`s with
  direct network reachability to `192.168.1.1`, `192.168.53.120`, and `192.168.53.100–.102`. Both
  facts are properties of _where the reverse-proxy component runs_, not of any individual
  `HTTPRoute`'s hostname — so the "does the edge/routing layer need a network path into a
  higher-trust admin-plane zone" question the ticket raises is real regardless of whether the
  UniFi/TrueNAS/Proxmox routes themselves are flipped to `externallyAccessible` later.
  [`apps/traefik/externalApps.config.ts`, `apps/traefik/externalApps.ts`, `utils.ts`, and a
  repo-wide check of `externallyAccessible: true` usage across `apps/`]

---

## 1. Gateway API-conformant implementations survey

The official [Gateway API Implementations page](https://gateway-api.sigs.k8s.io/implementations/)
defines three conformance tiers: **Conformant** (passes all core tests for at least one Route
type + Profile combination, plus all claimed Extended features, for one of the two most recent
Gateway API releases), **Partially Conformant** (aiming for but not yet at Conformant, for one of
the three most recent releases), and **Stale** (inactive, slated for removal). It also defines two
**profiles**: **Gateway controller** (reconciles `Gateway`, handles north-south/ingress traffic)
and **Mesh** (reconciles `Service` + attached `HTTPRoute`, handles east-west/GAMMA traffic).
Implementations can be either or both.

As fetched from that page, current status (subject to the page's own periodic review cycle):

| Implementation                                    | Gateway-controller conformance | Mesh (GAMMA) conformance |
| ------------------------------------------------- | ------------------------------ | ------------------------ |
| Traefik Proxy                                     | Conformant                     | —                        |
| Cilium                                            | Conformant                     | **Conformant**           |
| Istio                                             | Conformant                     | **Conformant**           |
| kgateway                                          | Conformant                     | —                        |
| NGINX Gateway Fabric                              | Conformant                     | —                        |
| HAProxy Ingress                                   | Conformant (since v0.17)       | —                        |
| Envoy Gateway                                     | **Partially Conformant**       | —                        |
| Gloo Gateway (pre-kgateway rename)                | Partially Conformant           | —                        |
| Calico (built on tigera-operator + Envoy Gateway) | Partially Conformant           | —                        |
| AWS Load Balancer Controller / Amazon EKS         | Partially Conformant           | —                        |

Only **Istio** and **Cilium** are listed as Mesh/GAMMA-conformant — the same two flagged in the
prior mesh-implementation research
([#20](https://github.com/aaronkyriesenbach/catalyst/issues/20)) as viable mesh choices. This is
directly relevant to Question 3 below.
[Gateway API Implementations page](https://gateway-api.sigs.k8s.io/implementations/)

### Traefik Proxy (current)

"Traefik Proxy fully supports all HTTPRoute core and some extended features, like
`BackendTLSPolicy`, `GRPCRoute`, and `TLSRoute` resources from the Standard channel, as well as
`TCPRoute` from the Experimental channel," and currently supports Gateway API v1.6.1.
**Distro coupling**: k3s bundles Traefik and its Gateway API provider by default; disabling it
if you keep it is unnecessary (this repo already configures it via
`cluster/traefik-config.yaml`'s `providers.kubernetesGateway.enabled: true`), but _replacing_ it
would use k3s's documented `--disable=traefik` flag or a `traefik.yaml.skip` file — a one-line,
fully reversible operation, not a rebuild.
**Operational complexity**: lowest of any surveyed option for this repo specifically, since it's
already running, already wired into `cluster/traefik-config.yaml`'s HelmChartConfig pattern, and
every existing `AppConfig`/modifier assumes its `gatewayClassName`/`traefik.io` `Middleware`
CRD.
[Gateway API Implementations page — Traefik entry](https://gateway-api.sigs.k8s.io/implementations/),
[k3s — Managing Packaged Components](https://docs.k3s.io/installation/packaged-components)

### Envoy Gateway

Listed **Partially Conformant**, not Conformant — a materially different maturity signal than
its "Envoy subproject" pedigree might suggest; the implementations page doesn't break out which
specific tests fail, only that it hasn't cleared the Conformant bar. It does directly implement
`BackendTLSPolicy`: its own task doc states "Envoy Gateway supports the Gateway-API defined
BackendTLSPolicy" and walks through a working example. Envoy Gateway also ships its own
CRD-based extensions beyond core Gateway API — `BackendTrafficPolicy`, `ClientTrafficPolicy`,
`SecurityPolicy` (which is where its own OIDC/JWT/basic-auth/external-auth support lives, per its
docs nav) — a materially larger and more capable feature surface than Traefik's, at the cost of
more CRDs and concepts to learn for a single operator. **Distro coupling**: none — it's not
bundled by any mainstream distro and doesn't touch kube-proxy or CNI; it's an independent
Deployment + CRDs, installed via Helm alongside the standard Gateway API CRDs.
[Gateway API Implementations page — Envoy Gateway entry](https://gateway-api.sigs.k8s.io/implementations/),
[Envoy Gateway — Backend TLS: Gateway to Backend](https://gateway.envoyproxy.io/docs/tasks/security/backend-tls/)

### Cilium (Gateway API mode)

**Conformant** for Gateway API v1.6.1 across `GatewayClass`, `Gateway`, `HTTPRoute`, `GRPCRoute`,
`TLSRoute`, `BackendTLSPolicy`, `ReferenceGrant`, `ListenerSet`, `TCPRoute`, `UDPRoute` — the
broadest resource coverage of any implementation surveyed. **Distro coupling is real and
non-trivial**: "Cilium must be configured with the kube-proxy replacement, using
`kubeProxyReplacement=true`" as a hard prerequisite for Gateway API support — meaning adopting
Cilium as the Gateway API implementation is inseparable from adopting Cilium as the CNI/kube-proxy
replacement, which (per the prior mesh research) means migrating off k3s's default Flannel CNI, a
cluster-wide change. **Architecture**: unlike other implementations, Cilium's ingress/Gateway API
traffic is intercepted by eBPF at the node and transparently forwarded to a per-node Envoy via
TPROXY — "one of the biggest differences between Cilium's Ingress and Gateway API support and
other Ingress controllers is how closely tied the implementation is to the CNI." This also means
Cilium's own `CiliumNetworkPolicy` engine can apply policy to Gateway API traffic at two logical
enforcement points (before the `ingress` identity, and after, exiting the per-node Envoy) — a
capability no other surveyed implementation has, because none of the others are the CNI.
**Operational complexity**: higher than any other option for this repo specifically, purely
because of the CNI migration, not because Cilium's Gateway API surface itself is hard to operate.
[Cilium — Gateway API Support](https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gateway-api/)

### Istio (Gateway API mode / ingress gateway)

**Conformant** for both profiles. "A minimal install of Istio can be used to provide a fully
compliant implementation of the Kubernetes Gateway API for cluster ingress traffic control. For
service mesh users, Istio also fully supports the GAMMA initiative's Gateway API support for
east-west traffic management within the mesh" — i.e. the same Istio install can serve as _both_
the Gateway-controller and the GAMMA mesh implementation, or just one, at the operator's choice.
Istio's own ingress gateway is architecturally just an Envoy proxy managed the same way as the
mesh's own data-plane proxies (sidecar or ambient `ztunnel`/waypoint), so — unlike Traefik/Envoy
Gateway/kgateway/NGINX Gateway Fabric, which are separate projects from any mesh — choosing Istio
as the Gateway API implementation and choosing Istio as the mesh are the _same adoption decision_,
not two. This repo's own prior mesh research ([#20](https://github.com/aaronkyriesenbach/catalyst/issues/20))
already recommends Istio ambient mode as the mesh implementation _without_ requiring Traefik to
be replaced or meshed — Istio's own docs confirm this is a supported shape: "An ingress gateway
may run in a non-ambient namespace, and expose services provided by ambient mode, sidecar mode or
non-mesh pods," so keeping Traefik as ingress while adopting Istio ambient underneath is
explicitly first-party supported, same as choosing Istio for both roles.
**Distro coupling**: none — independent of k3s/CNI, installed via `istioctl`/Helm.
**Operational complexity**: using Istio _only_ as a Gateway API ingress (not adopting the mesh)
is a materially smaller footprint than the full mesh, but still means learning Istio's own
install/CRD model instead of reusing whatever's simplest; using it for _both_ roles collapses two
learning curves into one but couples the two decisions (see Question 3).
[Gateway API Implementations page — Istio entry](https://gateway-api.sigs.k8s.io/implementations/),
[Istio — Add workloads to the mesh](https://istio.io/latest/docs/ambient/usage/add-workloads/)

### NGINX Gateway Fabric

**Conformant**, an official F5/NGINX project distinct from the older NGINX Ingress Controller.
Its own "Gateway API compatibility" doc gives resource-by-resource, field-by-field support
tables — the most granular of any implementation surveyed. `BackendTLSPolicy` is listed
**Core: Partially supported, Extended: Supported, Implementation-specific: Partially Supported**;
concretely, `caCertificateRefs` (`ConfigMap`/`Secret`), `hostname`, and
`wellKnownCertificates: System` all work, but `subjectAltNames` (an Extended-support SPIFFE-style
feature) is **not supported**. This repo's current `BackendTLSPolicy` usage only needs
`caCertificateRefs` + `hostname` (see `apps/traefik/externalApps.ts`), so NGINX Gateway Fabric's
gap doesn't affect this repo's actual usage today. **Distro coupling**: none.
**Operational complexity**: comparable to Envoy Gateway — an independent, well-documented,
actively developed project, with an "Advanced features with NGINX Plus" tier for
paid/enterprise features not relevant to a homelab.
[NGINX Gateway Fabric — Gateway API compatibility](https://docs.nginx.com/nginx-gateway-fabric/overview/gateway-api-compatibility/)

### HAProxy Kubernetes Ingress Controller (HAProxy Ingress)

**Conformant since v0.17** for `Gateway`, `HTTPRoute`, `TLSRoute`, `TCPRoute`, `ReferenceGrant`
core features. Its own v0.17 docs explicitly list what's **currently unsupported**: `GRPCRoute`,
`UDPRoute` (permanently, since HAProxy doesn't do UDP routing), and — directly relevant here —
**`BackendTLSPolicy`**. This is a hard, documented feature-parity gap against this repo's actual
usage: adopting HAProxy Ingress as-is would mean losing the `BackendTLSPolicy`-based backend
certificate validation this repo uses for the UniFi/TrueNAS/Proxmox reverse proxies, with no
stated timeline for when (or whether) it lands. **Distro coupling**: none.
**Operational complexity**: HAProxy itself is a well-understood, mature proxy; the Ingress
controller project is smaller/less resourced than Envoy Gateway or NGINX Gateway Fabric based on
its own roadmap language ("Spec conformance will be gradually incremented").
[HAProxy Ingress v0.17 — Gateway API](https://haproxy-ingress.github.io/v0.17/docs/configuration/gateway-api/)

### kgateway (formerly Gloo Gateway)

**Conformant**, "generally available with its 2.0 release" per the Gateway API implementations
page. Originally Solo.io's Gloo Gateway, now a CNCF sandbox project ("kgateway was originally
created by Solo.io and was known as Gloo" — kgateway's own site footer). Supports
`BackendTLSPolicy` for simple one-way TLS origination, with its own richer `BackendConfigPolicy`
CRD available for cases needing per-hostname SNI or origination to external (non-cluster)
backends — directly relevant to this repo's non-cluster `ExternalApp` pattern. Notably, kgateway's
own **feature-maturity reference table** lists `BackendTLSPolicy` under "Experimental features in
Gateway API" requiring "the experimental channel of the Kubernetes Gateway API" — even though
upstream Gateway API itself promoted `BackendTLSPolicy` to GA/Standard channel as of v1.4.0. This
looks like kgateway's own docs/CRD-channel support lagging the upstream promotion; worth
re-checking against the currently-released kgateway version before relying on it, rather than
assuming parity with Traefik/Envoy Gateway/Cilium's Standard-channel support.
kgateway's most distinctive trait for this repo's Question 3: **"Istio ambient and sidecar
integration"** is marked **GA** in its own maturity table, and it ships dedicated, versioned docs
for using kgateway as the gateway proxy _inside_ an Istio ambient or sidecar mesh — including a
documented gotcha directly relevant to `BackendTLSPolicy`: _"If your gateway proxy runs inside an
Istio service mesh, Istio's automatic mTLS can override the TLS settings from your
BackendTLSPolicy or BackendConfigPolicy, causing backend TLS connections to fail... add the
`kgateway.dev/disable-istio-auto-mtls: "true"` annotation."_ This is the clearest documented
example found in this research of the exact kind of boundary friction that keeping ingress and
mesh as **separate** components can introduce (see Question 3) — kgateway deliberately stays a
separate project from Istio and documents the interaction surface, rather than collapsing into
one component.
**Distro coupling**: none.
**Operational complexity**: comparable to Envoy Gateway/NGINX Gateway Fabric — an independent
project with its own CRDs, Helm chart, and now a broader "Agentgateway" sibling product for
AI/LLM traffic that isn't relevant here.
[Gateway API Implementations page — kgateway entry](https://gateway-api.sigs.k8s.io/implementations/),
[kgateway — Backend TLS](https://kgateway.dev/docs/envoy/latest/security/backend-tls/),
[kgateway — Feature maturity](https://kgateway.dev/docs/envoy/latest/reference/feature-maturity/),
[kgateway — Istio integrations](https://kgateway.dev/docs/envoy/latest/integrations/istio/)

### Others noted on the implementations page but not deep-dived

Agentgateway, Airlock Microgateway, Kong Operator, Gravitee Kubernetes Operator, Varnish Gateway,
Sunbeam Proxy, and WSO2 Gateway are all listed Conformant, but are either narrowly
scoped (Agentgateway: AI/LLM traffic; Varnish: caching-first), enterprise/commercial-first
(Airlock: WAAP/OpenShift-certified; Kong, WSO2: full API-management platforms with licensing
tiers), or too new/low-adoption for a single-operator homelab to be a sensible primary candidate
relative to the seven above. Calico's Gateway API support is explicitly built on top of
Envoy Gateway (via `tigera-operator`), so it's evaluated here as "Envoy Gateway plus a CNI you'd
also have to adopt," not a distinct option. [Gateway API Implementations page](https://gateway-api.sigs.k8s.io/implementations/)

---

## 2. Feature parity against this repo's actual current usage

**Dual internal/external Gateway split**: this is a _pattern_, not an implementation-specific
feature — it's just two `Gateway` resources with hostname-scoped listeners, both pointed at
whatever `GatewayClass`/controller is installed. Every Conformant implementation surveyed supports
multiple `Gateway` resources and per-listener `hostname` matching (it's core Gateway API, tested
by the core conformance suite). Switching implementations means swapping `gatewayClassName` and
installing the new controller — not redesigning the routing topology.

**`HTTPRoute`**: core Gateway API, universally supported by every Conformant implementation
surveyed (that's definitionally what Gateway-controller-profile conformance tests). No
differentiation here.

**`BackendTLSPolicy`**: this is where real differentiation exists. Summary of what was directly
verified above:

| Implementation       | `BackendTLSPolicy` support                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Traefik              | Full (Standard channel, listed as a supported extended feature)                                                                                     |
| Envoy Gateway        | Full (dedicated task doc + example)                                                                                                                 |
| Cilium               | Full (listed in its Conformant v1.6.1 resource set)                                                                                                 |
| NGINX Gateway Fabric | Core: Partially supported; Extended: Supported; no `subjectAltNames`                                                                                |
| kgateway             | Supported, but gated behind the Gateway API _experimental_ channel per kgateway's own docs (possible lag vs. upstream's Standard-channel promotion) |
| HAProxy Ingress      | **Not supported** (explicitly listed as unsupported in v0.17 docs)                                                                                  |
| Istio                | Not confirmed either way from Istio's own Gateway API ingress task docs in this research — flagged as an open question rather than assumed          |

This repo's actual `BackendTLSPolicy` usage (`apps/traefik/externalApps.ts`) only needs
`caCertificateRefs` (a `ConfigMap`) + `hostname` — the baseline, not the SPIFFE-flavored
`subjectAltNames` extension. That means Traefik, Envoy Gateway, Cilium, and NGINX Gateway Fabric
all satisfy this repo's actual needs today; **HAProxy Ingress would regress this specific
capability**; kgateway's status needs a version-specific check before relying on it; Istio's
status is simply unknown from what was verified here and should be checked directly against
Istio's Gateway API resource support docs before ruling it in or out on this axis.

**OIDC forward-auth (implementation-specific, not core Gateway API)**: every mainstream option
surveyed has _some_ first-party OIDC/authn mechanism (Traefik: `traefik-oidc-auth` plugin +
`Middleware` CRD via `ExtensionRef`; Envoy Gateway: `SecurityPolicy` CRD with OIDC; NGINX Gateway
Fabric: documented "Configure OpenID Connect (OIDC) authentication" guide; kgateway: "OAuth2/OIDC
overview" with a documented Keycloak walkthrough), but none share Traefik's exact CRD/plugin
shape. Switching implementations means re-implementing `docs/forward-auth.md`'s flow against the
new implementation's own extension mechanism — a real migration cost, not a blocker, and one that
exists precisely because `ExtensionRef` filters are Gateway API's own designed non-portable
escape hatch. Cilium's Gateway API docs (as fetched for this research) describe L7 traffic
management via `CiliumNetworkPolicy` (methods/headers/paths) but don't surface an OIDC/user-auth
mechanism at the Gateway API layer — this looks like a real gap for Cilium specifically, though
it wasn't exhaustively verified against Cilium's full docs tree.

---

## 3. Overlap with the service-mesh decision

Recap: a service mesh is already decided **in scope**, explicitly for hands-on mTLS learning, not
operational necessity ([#33, closed](https://github.com/aaronkyriesenbach/catalyst/issues/33)).
_Which_ mesh is still open ([#21](https://github.com/aaronkyriesenbach/catalyst/issues/21)), and
the prior research for that decision
([#20](https://github.com/aaronkyriesenbach/catalyst/issues/20), full write-up on
`research/mesh-impl-research`) recommends **Istio in ambient mode**, specifically _because_ it
doesn't require touching or meshing Traefik — ztunnel enforces mTLS at the destination pod
regardless of whether the caller (Traefik) is itself meshed.

**Which implementations can serve as both Gateway API ingress and mesh?** Per the official
implementations page, only **Cilium** and **Istio** are Mesh/GAMMA-conformant _in addition to_
being Gateway-controller-conformant — i.e., the only two projects where a single control plane
can legitimately own both north-south (`Gateway`/`HTTPRoute`) and east-west (GAMMA) traffic. Every
other Gateway-controller-conformant option surveyed (Traefik, Envoy Gateway, NGINX Gateway
Fabric, HAProxy Ingress, kgateway) is ingress-only and pairs with a mesh as a **separate**
component. kgateway is the most explicit about this pairing: it markets itself for
"interoperating with a service mesh such as Istio in both ambient and sidecar modes" and ships
GA-level, versioned integration docs for exactly that pairing — it is deliberately _not_ trying
to also be the mesh.

**Collapsing (one component does both) vs. keeping them separate:**

_Collapsing pros:_

- Fewer moving parts to operate/upgrade/monitor — one control plane, one CRD surface, one set of
  logs/metrics for both ingress and mesh traffic.
- Consistent policy model: Cilium's own docs describe Gateway API traffic passing through the
  _same_ per-node Envoy + eBPF policy engine that also enforces `CiliumNetworkPolicy` for
  east-west traffic — ingress and mesh policy share one enforcement substrate. Istio's ingress
  gateway is architecturally just another Envoy instance managed identically to the mesh's own
  data-plane proxies, so `PeerAuthentication`/mTLS policy and ingress routing share one CRD
  vocabulary if you choose Istio for both roles.
- No boundary-interaction bugs of the kind kgateway explicitly documents (Istio's automatic mTLS
  silently overriding a separate ingress's `BackendTLSPolicy`) — if the same component owns both
  concerns, that specific class of conflict can't arise the same way.

_Collapsing cons:_

- Bigger blast radius: a bug or outage in the one shared component now affects both north-south
  and east-west traffic simultaneously, instead of failure being contained to whichever layer hit
  it.
- Harder to reverse independently: choosing Istio for ingress _and_ mesh means a later decision
  to swap the mesh (or the ingress) likely means touching both, where two separate components let
  either be swapped without the other.
- For Cilium specifically, collapsing is **not just an ingress decision** — it requires migrating
  the CNI itself off Flannel (per the mesh-impl-research findings on kube-proxy replacement being
  a hard Gateway API prerequisite), a materially larger, cluster-wide, high-blast-radius change
  that the ingress decision alone shouldn't be forced to carry.

_Separate pros:_

- Matches the reasoning that already won the mesh-implementation research: Istio ambient mode was
  specifically recommended _because_ it doesn't require modifying or meshing the existing
  ingress — the two decisions (ingress, mesh) stay independently reversible.
- Smaller, incremental adoption: the existing ingress keeps working unmodified while the mesh is
  layered underneath and learned in isolation, rather than learning a new ingress API surface and
  a new mesh at the same time.
- Fits this repo's stated migration philosophy generally (incremental/parallel-build over
  big-bang, per the map's standing preferences) — swapping ingress and adopting a mesh become two
  separate, independently-timed pieces of work instead of one coupled cutover.

_Separate cons:_

- Two components to operate, upgrade, and monitor instead of one.
- Real, documented boundary friction can occur (the kgateway/Istio auto-mTLS-vs-BackendTLSPolicy
  example above is a concrete instance, not a hypothetical) — though it's a known, documented,
  workaroundable interaction, not an unsolved problem.

---

## 4. Architectural placement: does the routing/edge layer have a hard network-zone constraint?

**The concrete requirement**: whatever runs the routing/edge layer needs network reachability
from wherever its pods land into wherever UniFi (`192.168.1.1`), TrueNAS (`192.168.53.120`), and
Proxmox (`192.168.53.100–.102`) end up living once network segmentation
([#5](https://github.com/aaronkyriesenbach/catalyst/issues/5)) is decided — because that
reachability is already encoded today as literal `EndpointSlice` addresses the reverse-proxy
component holds (see the correction above: this holds regardless of whether those specific routes
are internet-facing). The same component (today, Traefik; potentially something else post-#36)
also terminates genuinely internet-facing traffic for several apps via `traefik-external`.

**What standard firewall/DMZ guidance says about this shape.** NIST SP 800-41 Rev. 1,
_Guidelines on Firewalls and Firewall Policy_ (the standard, primary-source reference for
firewall/DMZ architecture), defines the DMZ pattern precisely as this shape:

> "Many hardware firewall devices have a feature called DMZ... While no single technical
> definition exists for firewall DMZs, they are usually interfaces on a routing firewall that are
> similar to the interfaces found on the firewall's protected side. The major difference is that
> traffic moving between the DMZ and other interfaces on the protected side of the firewall still
> goes through the firewall and can have firewall protection policies applied... It is common to
> put public-facing servers, such as web and email servers, on the DMZ... Traffic from the
> Internet goes into the firewall and is routed to systems on the firewall's protected side or to
> systems on the DMZ. Traffic between systems on the DMZ and systems on the protected network goes
> through the firewall, and can have firewall policies applied."

And separately, on placing sensitive systems: "Important internal systems should be placed behind
internal firewalls." Read together, NIST's own doctrine is that a public-facing component
reaching into a more-trusted zone is the **textbook DMZ pattern**, not an anti-pattern — _provided_
the DMZ-to-protected-network traffic still passes through an explicit firewall/policy enforcement
point rather than being freely routable. NIST does not say "never let a DMZ host talk to the
protected network"; it says "make sure that traffic still goes through the firewall and can have
policy applied to it."
[NIST SP 800-41 Rev. 1](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf)

**The zero-trust reframing reinforces this rather than contradicting it.** NIST SP 800-207, _Zero
Trust Architecture_, reframes the same concern in resource-centric terms: "Zero trust assumes
there is no implicit trust granted to assets or user accounts based solely on their physical or
network location... Authentication and authorization... are discrete functions performed before a
session to an enterprise resource is established." This doesn't argue against a DMZ-style
component reaching a protected zone — it argues against granting that reachability _implicit_
trust merely because of where the traffic originates. The two documents combine into one coherent
rule: **network-level reachability from edge to admin-plane is fine; reachability substituting for
authentication/authorization is not.**
[NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final)

**This repo's actual UniFi hardware already supports the exact enforcement model NIST describes.**
The prior Unifi-capability research
([#4](https://github.com/aaronkyriesenbach/catalyst/issues/4)/`research/unifi-segmentation-research`)
confirms the current UniFi console supports **Zone-Based Firewall** (Network app 9.0+): built-in
zones include External, Internal, Gateway, VPN, Hotspot, and **DMZ** ("for networks that need to
expose public-facing services"), with policy defined per source→destination zone pair in a Zone
Matrix, including explicit intra-zone and cross-zone rule authoring. This is the same DMZ /
policy-enforcement-point model NIST describes, already available on the hardware, independent of
whatever VLAN/IPAM scheme #5 lands on.

**Synthesis for #36 and #5**: the routing/edge layer does **not** have a hard constraint that
categorically forbids it from reaching a higher-trust admin-plane zone — standard DMZ doctrine
explicitly allows exactly this shape. What it _does_ argue for:

1. Whatever zone the routing/edge layer lives in should be modeled as a distinct zone (an
   External/DMZ-equivalent in UniFi's Zone-Based Firewall vocabulary) from wherever
   UniFi/TrueNAS/Proxmox admin planes live, with an **explicit, narrow Zone Matrix rule** for
   edge→admin-plane traffic — not a blanket "cluster VLAN can reach management VLAN" allowance.
   This repo's current implementation already has the right shape for "narrow": each
   `ExternalApp` targets one specific host:port (not a subnet), over TLS validated against a
   pinned internal CA (`BackendTLSPolicy` + `internal-root-ca-bundle`) rather than trusting
   whichever host answers on that IP.
2. Per SP 800-207, that network path should not be the sole authorization boundary — the admin
   planes' own logins remain the real authorization gate, and this repo's existing
   `forwardAuth`/OIDC middleware mechanism (`docs/forward-auth.md`) is a directly-applicable,
   already-built tool for adding an authentication gate in front of these specific routes, which
   is not currently applied to the three `ExternalApp` reverse proxies (they're built via a plain
   `buildRoute()` call with no `forwardAuth: true`). Whether to add it is a judgment call — these
   admin planes have their own login pages already — but it's worth #36 or a follow-up ticket
   explicitly deciding rather than leaving as an oversight either way.
3. This is a genuine input to #5, not something #5 can ignore: whichever VLAN/zone design #5
   picks needs to leave room for a scoped edge→admin-plane path to exist, however narrow. It does
   _not_ need to put the routing/edge layer _in_ the same zone as the admin planes, and standard
   guidance would argue against that (mixing DMZ-tier and protected-tier hosts on the same zone
   defeats DMZ's purpose) — it needs a firewalled, explicitly-policied path _between_ them.

---

## Comparison summary

|                                             | Traefik                      | Envoy Gateway                             | Cilium                                           | Istio                                                            | NGINX Gateway Fabric | HAProxy Ingress                          | kgateway                             |
| ------------------------------------------- | ---------------------------- | ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- | -------------------- | ---------------------------------------- | ------------------------------------ |
| Gateway-controller conformance              | Conformant                   | Partially Conformant                      | Conformant                                       | Conformant                                                       | Conformant           | Conformant (v0.17+)                      | Conformant                           |
| Mesh/GAMMA conformance                      | —                            | —                                         | Conformant                                       | Conformant                                                       | —                    | —                                        | —                                    |
| `BackendTLSPolicy` support                  | Full                         | Full                                      | Full                                             | Unconfirmed                                                      | Partial (no SAN)     | **Not supported**                        | Full, but experimental-channel gated |
| Needs a distro default disabled/replaced    | No (already the k3s default) | No                                        | **Yes — kube-proxy replacement / CNI migration** | No                                                               | No                   | No                                       | No                                   |
| Can also serve as the mesh                  | No                           | No                                        | Yes                                              | Yes                                                              | No                   | No                                       | No (pairs with Istio instead)        |
| Operational complexity for this repo, today | Lowest (already running)     | Medium (independent project, richer CRDs) | Highest (CNI migration)                          | Medium (independent project; doubles as mesh if chosen for both) | Medium               | Medium, but regresses `BackendTLSPolicy` | Medium                               |

---

## Recommendation

This is research for #36 to weigh, not a decision — but stated plainly:

**Keep Traefik as the Gateway API implementation for now, and keep the ingress/mesh decisions
separate.** Reasoning:

1. **Nothing surveyed here demonstrates a feature gap Traefik actually has against this repo's
   real usage.** Traefik is Conformant, fully supports `HTTPRoute` and `BackendTLSPolicy` (the two
   Gateway API resources this repo actually uses), and the internal/external Gateway split is a
   portable pattern, not a Traefik-specific trick. The only real cost of _any_ switch is
   re-implementing OIDC forward-auth against a new extension mechanism — a real but bounded
   migration cost that exists no matter which alternative is picked.
2. **Switching to gain Gateway API features alone isn't justified at this scale.** Envoy Gateway,
   NGINX Gateway Fabric, and kgateway all offer richer extension ecosystems (SecurityPolicy,
   custom policies, BackendConfigPolicy) than Traefik's plugin model, but this repo's actual usage
   doesn't currently need any of that richness — a single-operator homelab with no SLA doesn't
   benefit from adopting operational surface area it doesn't need yet.
3. **Cilium's Gateway API mode is not "just an ingress swap"** — its hard `kubeProxyReplacement`
   prerequisite makes it a CNI decision wearing an ingress-decision costume. If Cilium is ever
   adopted (e.g., for eBPF observability or as the mesh, contingent on its mutual-authentication
   feature maturing past Beta per the prior mesh research), gaining its Gateway API conformance
   for free at that point is a reasonable bonus — but it's not a reason to adopt Cilium _now_,
   purely for ingress.
4. **HAProxy Ingress should be ruled out** for this repo specifically: it's the only surveyed
   Conformant implementation with a _documented, explicit_ `BackendTLSPolicy` gap, which is a
   capability this repo actively uses today.
5. **Given the mesh-implementation research already recommends Istio ambient specifically
   _because_ it doesn't require touching Traefik**, the two decisions are already aligned to stay
   separate — collapsing them into "adopt Istio for both ingress and mesh" would mean redoing
   the mesh research's own reasoning in the opposite direction, and would couple two decisions
   that this repo's stated migration philosophy (incremental, parallel-build, reversible) argues
   should stay independently swappable.
6. **The strongest reason to eventually revisit this** isn't a Gateway API feature gap — it's
   whatever #7 (cluster-lifecycle/distro) decides. If a future distro doesn't bundle Traefik the
   way k3s does, "keep Traefik" becomes "explicitly install Traefik" — a smaller decision than it
   sounds, but worth re-confirming once #7 lands, rather than assuming continuity.

The final call — including whether the architectural-placement findings in Section 4 change
anything, and how this interacts with whatever #5 and #7 decide — belongs to
[#36](https://github.com/aaronkyriesenbach/catalyst/issues/36).

---

## Sources

- Gateway API Implementations page — https://gateway-api.sigs.k8s.io/implementations/
- Gateway API `BackendTLSPolicy` reference — https://gateway-api.sigs.k8s.io/reference/api-types/policy/backendtlspolicy/
- Traefik Proxy (via Gateway API Implementations page, above)
- Envoy Gateway — Backend TLS: Gateway to Backend — https://gateway.envoyproxy.io/docs/tasks/security/backend-tls/
- Cilium — Gateway API Support — https://docs.cilium.io/en/stable/network/servicemesh/gateway-api/gateway-api/
- Istio — Add workloads to the mesh — https://istio.io/latest/docs/ambient/usage/add-workloads/
- NGINX Gateway Fabric — Gateway API compatibility — https://docs.nginx.com/nginx-gateway-fabric/overview/gateway-api-compatibility/
- HAProxy Ingress v0.17 — Gateway API — https://haproxy-ingress.github.io/v0.17/docs/configuration/gateway-api/
- kgateway — Backend TLS — https://kgateway.dev/docs/envoy/latest/security/backend-tls/
- kgateway — Feature maturity — https://kgateway.dev/docs/envoy/latest/reference/feature-maturity/
- kgateway — Istio integrations — https://kgateway.dev/docs/envoy/latest/integrations/istio/
- k3s — Managing Packaged Components — https://docs.k3s.io/installation/packaged-components
- k3s — Server CLI reference — https://docs.k3s.io/cli/server
- NIST SP 800-41 Rev. 1, _Guidelines on Firewalls and Firewall Policy_ — https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-41r1.pdf
- NIST SP 800-207, _Zero Trust Architecture_ — https://csrc.nist.gov/pubs/sp/800/207/final
- catalyst repo (current-state context): `apps/traefik.ts`, `apps/traefik/gateway.ts`,
  `apps/traefik/routes.ts`, `apps/traefik/externalApps.config.ts`, `apps/traefik/externalApps.ts`,
  `utils.ts`, `types.ts`, `modifiers.ts`, `docs/forward-auth.md`, `cluster/traefik-config.yaml`,
  `cluster/README.md`, `AGENTS.md`, `package.json`
- Sibling research: `docs/research/mesh-impl-research.md` (branch
  `research/mesh-impl-research`, [#20](https://github.com/aaronkyriesenbach/catalyst/issues/20));
  `docs/research/unifi-segmentation-research.md` (branch
  `research/unifi-segmentation-research`, [#4](https://github.com/aaronkyriesenbach/catalyst/issues/4))
- GitHub issues: [#35](https://github.com/aaronkyriesenbach/catalyst/issues/35),
  [#36](https://github.com/aaronkyriesenbach/catalyst/issues/36),
  [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1),
  [#33](https://github.com/aaronkyriesenbach/catalyst/issues/33),
  [#21](https://github.com/aaronkyriesenbach/catalyst/issues/21),
  [#20](https://github.com/aaronkyriesenbach/catalyst/issues/20),
  [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5),
  [#7](https://github.com/aaronkyriesenbach/catalyst/issues/7)
