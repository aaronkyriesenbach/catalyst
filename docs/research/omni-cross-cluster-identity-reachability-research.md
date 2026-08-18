# Research: cross-cluster network reachability for machine-identity discovery traffic (Omni proxy vs. ADR 0010's LAN path)

**Ticket**: [#57](https://github.com/aaronkyriesenbach/catalyst/issues/57) — feeds the resumed grilling session in
[Decide machine-identity mechanism for workload identity across the multi-cluster platform
(#55)](https://github.com/aaronkyriesenbach/catalyst/issues/55), surfaced as a shared, unresolved gap in both
[#54's](https://github.com/aaronkyriesenbach/catalyst/issues/54)
(`docs/research/machine-identity-research.md`, branch `research/machine-identity-research`) and
[#56's](https://github.com/aaronkyriesenbach/catalyst/issues/56)
(`docs/research/identity-broker-machine-identity-research.md`, branch
`research/identity-broker-machine-identity-research`) prior research — part of the ["Homelab platform
rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: whichever mechanism family #55 lands on — a dedicated SPIRE control plane, or an identity-broker
platform (Dex/authentik/Pocket ID/Authelia) acting as a JWKS-federation broker — needs a real cross-cluster
network path for identity-discovery traffic: a broker (platform cluster) reaching a workload cluster's own
JWKS, or a SPIRE Agent (workload cluster) reaching the SPIRE Server (platform cluster). This document
investigates, against primary sources only, what Omni's WireGuard-tunneled proxy actually carries (ADR
0011's documented purpose is authenticated Kubernetes-API-server traffic specifically), whether ADR 0010's
already-accepted LAN/`LoadBalancer`-Service precedent (CNPG's cross-cluster Postgres connectivity) actually
generalizes to arbitrary HTTP/gRPC identity traffic, what if anything of either mechanism family would still
depend on Omni's proxy, and whether Omni has shipped or is shipping anything newer and more direct than the
open feature request ([siderolabs/omni#2663](https://github.com/siderolabs/omni/issues/2663)) #54 already
found. **It does not decide anything** — per this ticket's own instructions, the decision is deferred to the
grilling session in [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55).

---

## TL;DR

- **Omni's WireGuard overlay (SideroLink) is structurally incapable of being a general cross-cluster network
  tunnel at all — it is a strict hub-and-spoke relay, confirmed by Talos's own docs, not merely a documented
  convention.** Talos's own SideroLink doc states plainly: **"SideroLink only supports point-to-point
  connections between Talos machines and the SideroLink management server; direct communication between two
  Talos machines over SideroLink is not possible."** — [Talos docs:
  SideroLink](https://docs.siderolabs.com/talos/v1.13/networking/siderolink.md). Every byte that ever moves
  between two Omni-managed clusters over this overlay has to be actively relayed by an Omni-implemented,
  Omni-authenticated application feature — there is no raw pipe a workload could route arbitrary traffic
  through, by design, independent of which two features currently exist to do that relaying (below).
- **Confirmed directly against a live Omni instance by an Omni maintainer, in the exact GitHub issue thread
  most relevant to this question: the discovery/JWKS endpoints genuinely do ride over the same authenticated
  path as ordinary `kubectl` traffic today, but resolve to addresses that are unreachable from outside Omni's
  own authenticated session, and Omni does not yet expose them as public, anonymous endpoints.** Testing
  `kubectl get --raw /.well-known/openid-configuration` against an Omni-managed cluster today returns
  `"issuer": "https://[fdae:...]:10000"` and `"jwks_uri": "https://172.21.0.3:6443/openid/v1/jwks"` — **"Both
  unreachable from outside. This is because Talos sets `--service-account-issuer` to the cluster's control
  plane endpoint, which in Omni's case is the SideroLink address."** — [siderolabs/omni#2266, comment by
  `utkuozdemir`](https://github.com/siderolabs/omni/issues/2266#issuecomment-4224152215) (Sidero Labs
  maintainer, dated 2026-04-10). This directly answers Question 1's core ask: Omni's proxy is not narrowly
  scoped to typical `kubectl` resource-CRUD verbs (an arbitrary raw HTTP GET against the API server's own
  `/.well-known/` path does traverse it, since it's the same HTTP server on the same port) — but it is
  scoped to the API server's own HTTP surface specifically, always behind Omni's own authenticated session,
  and today has **no path at all for a genuinely unauthenticated, anonymous, external caller** (like AWS STS,
  or a broker with no Omni credential) to fetch it.
- **ADR 0010's LAN/`LoadBalancer` path is real, generic, already-proven Kubernetes and CNPG infrastructure —
  not something CNPG-magic, and not merely theoretical.** Kubernetes' own docs describe `type: LoadBalancer`
  in fully generic terms: **"Exposes the Service externally using an external load balancer... Traffic from
  the external load balancer is directed at the backend Pods"** —
  [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/). CloudNativePG's
  own docs confirm its cross-cluster LB pattern is nothing more than this same generic primitive: **"The
  `serviceTemplate` field gives you access to the standard Kubernetes API for the network Service
  resource... CloudNativePG has no control over the service configuration, except honoring the
  selector."** — [CloudNativePG docs: Service
  Management](https://cloudnative-pg.io/docs/devel/service_management). And this repo's own sibling research
  (`docs/research/loadbalancer-talos-research.md`, [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46),
  already closed) independently confirmed kube-vip's DaemonSet+ARP `LoadBalancer` mechanism works unmodified
  on Talos, is already running in this repo today (`cluster/kube-vip-daemonset.yaml`,
  `cluster/traefik-config.yaml`), and found "no compelling reason... to introduce a second tool" (MetalLB) —
  meaning a JWKS-mirror Service or a SPIRE-Server Service, each exposed the same way ADR 0010 already exposes
  CNPG's `rw` Service, is real, working infrastructure today, not a hypothetical. The one open piece is
  formal, not mechanical: [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47) (which LB tool
  continues into the Talos/Omni multi-cluster fleet) remains an open ticket, but nothing in #46's own findings
  casts doubt on the underlying mechanism.
- **A genuine, sourced asymmetry exists between the two mechanism families on Question 3, not previously
  surfaced by #54/#56: the broker family can fully sidestep Omni's proxy for its actual identity-discovery
  traffic, but SPIRE's practically-relevant node attestor cannot.** A broker + JWKS-mirror design's only
  Omni-proxy dependency is the same, already-accepted one every app in this repo already has — GitOps
  deployment of the mirror app itself (ADR 0007/0011) — the mirror's own act of reading its *own* cluster's
  discovery document is ordinary in-cluster traffic, out of ADR 0011's scope entirely. SPIRE is structurally
  different: its own `k8s_psat` node-attestor docs state **"a kubernetes configuration file must be specified
  if SPIRE server runs outside of the k8s cluster"** — [SPIRE server plugin: NodeAttestor
  "k8s_psat"](https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_server_nodeattestor_k8s_psat.md), with
  `tokenreviews: create` RBAC required against that external cluster's own Kubernetes API. In this repo's
  topology (Server on the platform cluster, Agents on workload clusters), that means the SPIRE Server itself
  needs an **ongoing**, per-attestation credential to each workload cluster's actual Kubernetes API server —
  which, per ADR 0011, can only travel through Omni's WireGuard-tunneled proxy. Adopting the ADR-0010-style
  LAN path for Agent↔Server SVID traffic does not remove this dependency for SPIRE; it has no equivalent for
  the broker family at all.
- **Omni's own workload service proxying feature — shipped since roughly v1.3.0 (2025-11-07), not new since
  #54's research but not previously surfaced by this research thread either — is directly relevant context
  for Question 1: it proves Omni's tunnel can carry more than literal `kubectl`/API-server traffic (arbitrary
  annotated Kubernetes `Service` HTTP traffic), but it does not solve this ticket's problem.** Omni's own docs
  state: **"Exposed services are protected by Omni's authentication, so only users with at least `Reader`
  access to the cluster can access them"** and **"Workload service proxying only supports HTTP services. Raw
  TCP and UDP are not supported"** — [Omni docs: Expose a Workload via Service
  Proxy](https://docs.siderolabs.com/omni/cluster-management/expose-a-workload-via-service-proxy.md). Even
  this broader tunnel capability requires every calling machine (a broker, or a SPIRE Agent) to itself hold a
  valid Omni-recognized credential (human OIDC session or an Omni Service Account) just to get through Omni's
  front door — a heavier, Omni-specific credential this repo would have to bolt onto whichever identity
  mechanism #55 picks, on top of that mechanism's own native credential model, undermining the point of
  adopting either. It is also HTTP-only, an unconfirmed fit for SPIRE's gRPC Agent↔Server channel either way.
- **Nothing new or more direct has shipped for this specific problem since #54's research; the one genuinely
  on-point Omni feature request was never previously surfaced by this research thread at all.**
  [siderolabs/omni#2663](https://github.com/siderolabs/omni/issues/2663) (cited by ADR 0011/#54) remains open
  and unimplemented, and is the wrong direction regardless — its own text says **"this is the opposite
  direction: external systems authenticating to Omni,"** not Omni exposing a cluster's own OIDC outward.
  The right-direction issue, **[siderolabs/omni#2266](https://github.com/siderolabs/omni/issues/2266)**
  ("Provide OIDC URI for service account token issuer"), is genuinely new to this research thread — neither
  #54 nor #56 cites it — and is also still open and unimplemented, but now carries a concrete
  from-a-maintainer engineering sketch of exactly what shipping this would take (proxy the two discovery
  endpoints over SideroLink, unauthenticated; rewrite `--service-account-issuer` and `jwks_uri` to the Omni
  proxy's own public URL) — described by its author as **"bounded work with existing infrastructure,"** but
  with no PR, milestone, or committed timeline as of this research (parented under
  [siderolabs/omni#3207](https://github.com/siderolabs/omni/issues/3207), an open, informal backlog of "stories
  which can be implemented right now for Talos 1.14+"). Separately, Omni's own v1.10.0 release notes (2026-08-07,
  the most recent minor release found at research time) *tighten*, not loosen, Omni's ownership of
  `cluster.serviceAccount`/CA material — corroborating rather than contradicting #54's earlier finding.

---

## Question 1: What does Omni's WireGuard-tunneled proxy actually carry?

### The overlay itself is point-to-point only; Omni's own application layer is the sole relay

Omni's own docs describe SideroLink as the mechanism underneath every external access path: **"Machine
registration is built on top of the extremely fast WireGuard® technology built in to Linux. A technology
dubbed SideroLink builds upon WireGuard in order to provide a fully automated way of setting up and
maintaining a WireGuard tunnel between Omni and each registered machine."** — [Omni docs: Machine
Registration](https://docs.siderolabs.com/omni/infrastructure-and-extensions/machine-registration.md). Talos's
own SideroLink doc — the machine-side counterpart — is explicit about the overlay's topology limit, in
language stronger than a mere convention:

> "SideroLink offers a secure point-to-point management overlay network for Talos clusters using
> Wireguard. Each Talos machine configured with SideroLink establishes a secure Wireguard connection to
> the SideroLink API server... SideroLink only supports point-to-point connections between Talos
> machines and the SideroLink management server; **direct communication between two Talos machines over
> SideroLink is not possible.**"

— [Talos docs: SideroLink](https://docs.siderolabs.com/talos/v1.13/networking/siderolink.md). This is a
structural finding, not an operational one: even setting aside what Omni's application layer chooses to
expose, the underlying WireGuard fabric itself cannot be repurposed as a general cross-cluster tunnel between
a workload cluster's SPIRE Agent and a platform cluster's SPIRE Server, or between a broker and a JWKS
endpoint — Omni (the "SideroLink management server") is architecturally the only endpoint every machine can
reach, and it alone decides what gets relayed onward and to where.

### What Omni's application layer relays today, and how it's gated

Two distinct, Omni-implemented relaying features exist as of this research, and both are gated by Omni's own
authentication:

**1. The Kubernetes-API-endpoint proxy** — the one ADR 0011 already documents, confirmed again directly:
**"All `kubectl` requests are routed through the Kubernetes API endpoint created by Omni. Omni validates
access using the configured OpenID Connect (OIDC) provider or other authorization mechanism... This means
that possessing a `kubeconfig` file alone does not grant access. The user must also authenticate through
Omni's configured identity provider."** — [Omni docs: Use Kubectl With
Omni](https://docs.siderolabs.com/omni/getting-started/use-kubectl-with-omni.md). Omni's own security-model
doc frames this as one layer of a deliberately-layered system: **"Omni's security model is layered, combining
authentication, authorization, scoped access policies, and API-level RBAC to enforce permissions across
users and clusters."** — [Omni docs: Omni, Talos, and Kubernetes
Security](https://docs.siderolabs.com/omni/security-and-authentication/security-model.md). For non-interactive
callers, Omni substitutes a long-lived credential for the short-lived OIDC session but the gate itself is
identical in kind: **"A service account is a long-lived, static authentication token that can be used for the
Omni API. Service account tokens can allow access to Omni, Talos, and Kubernetes."** — same source. This is
exactly the mechanism ADR 0011 already uses for the GitOps hub's own cross-cluster ArgoCD registration
(Omni-issued Kubernetes-ServiceAccount-backed bearer tokens through this same proxy).

**Does this proxy carry more than ordinary `kubectl` resource verbs?** Yes — confirmed directly against a
live Omni instance, in the one GitHub issue thread that turns out to address this exact question, by a Sidero
Labs maintainer:

> "Verified the current state on a running Omni instance. Kube-apiserver OIDC discovery works today:
> ```
> $ kubectl get --raw /.well-known/openid-configuration
> {
>   "issuer": "https://[fdae:41e4:649b:9303::1]:10000",
>   "jwks_uri": "https://172.21.0.3:6443/openid/v1/jwks",
>   ...
> }
> ```
> The `issuer` is Omni's SideroLink address with the cluster's proxied port, and the `jwks_uri` is an
> internal cluster IP. **Both unreachable from outside.** This is because Talos sets
> `--service-account-issuer` to the cluster's control plane endpoint, which in Omni's case is the
> SideroLink address."

— [siderolabs/omni#2266, comment by
`utkuozdemir`](https://github.com/siderolabs/omni/issues/2266#issuecomment-4224152215), dated 2026-04-10. This
resolves Question 1's core framing directly: the proxy is not narrowly restricted to structured
resource-level `kubectl` verbs (`get pods`, `apply`, etc.) — a raw GET against whatever static path the API
server's own HTTP handler serves, including `/.well-known/openid-configuration` and (by the same logic)
`/openid/v1/jwks`, does traverse it, because it's the same HTTP listener on the same port that every other
`kubectl` request already reaches. But it is scoped to that one listener (the API server's own HTTP surface)
specifically, and it is **always** gated behind an Omni-recognized credential establishing the session in the
first place — there is no path, confirmed by the same maintainer's own test, for a genuinely anonymous,
external caller (no Omni credential of any kind) to reach it at all today. The values returned even for an
authenticated caller point back into address spaces (`fdae:...` — SideroLink's own ULA IPv6 range, and
`172.21.0.3` — an internal cluster/pod-network IP) that are not independently reachable outside that same
authenticated session, matching the same maintainer's blunt assessment: **"Both unreachable from
outside."** The original commenter on the same issue had proposed exactly the workaround this repo's
own #56 research independently arrived at from the Kubernetes side (a JWKS mirror / rewritten discovery
proxy): **"Use Omni as a proxy for the cluster's OIDC discovery endpoints so the external cloud provider can
reach an issuer URL... Omni will proxy requests over SideroLink to the kube-apiserver on the target cluster
and return the discovery document... and the JWKS... without requiring auth"** — [siderolabs/omni#2266,
comment by `pranav767`](https://github.com/siderolabs/omni/issues/2266#issuecomment-3890105224) — but, per
the maintainer's own follow-up, this doesn't exist yet (see Question 4).

**2. Workload service proxying** — a separate, more general-purpose relaying feature this research found and
that neither #54 nor #56 previously surfaced. Omni's own docs describe it as deliberately broader than the
Kubernetes-API-endpoint proxy: **"Omni's workload service proxying feature lets you expose HTTP services
running inside your managed clusters directly through Omni... This is useful for cluster-internal tools like
Grafana or the Kubernetes dashboard that you want to access without setting up a separate ingress or
VPN."** — [Omni docs: Expose a Workload via Service
Proxy](https://docs.siderolabs.com/omni/cluster-management/expose-a-workload-via-service-proxy.md). Mechanically,
an operator annotates an ordinary Kubernetes `Service` (`omni-kube-service-exposer.sidero.dev/port`, etc.),
and Omni relays HTTP traffic to it over the same SideroLink fabric — a genuinely more general tunnel
capability than "authenticated Kubernetes-API-server traffic" in the strict sense ADR 0011 documents, since
it can reach *any* annotated Service, not only the API server's own listener. But the same doc immediately
states the gate is identical in spirit to the kube-API proxy: **"Exposed services are protected by Omni's
authentication, so only users with at least `Reader` access to the cluster can access them,"** and narrows
the payload: **"Workload service proxying only supports HTTP services. Raw TCP and UDP are not
supported."** — same source. The self-hosted setup doc confirms the access-control framing is not incidental:
**"The workload proxy lets you expose HTTP services from managed clusters through Omni. Only users with
access to the cluster can reach them. On Omni SaaS no setup is needed. On a self-hosted instance, you need to
configure DNS, TLS, and routing before it works."** — [Omni docs: Enable Workload
Proxy](https://docs.siderolabs.com/omni/self-hosted/enable-workload-proxy.md). So even this broader mechanism
does not give this ticket's actual candidates (a broker with no Omni account, or a SPIRE Agent/Server pair)
an unauthenticated, credential-free path — every consuming client would still need its own valid
Omni-recognized identity (a human OIDC session, or a dedicated Omni Service Account minted and rotated per
this repo's own existing ADR 0011 renewal pattern) just to open the connection, on top of whatever credential
the identity mechanism itself is supposed to provide. Whether gRPC (SPIRE's Agent↔Server transport, itself
HTTP/2-framed) would even function through an HTTP-only exposer component was not confirmed either way by
this research — Omni's own docs state only that "raw TCP and UDP are not supported," without addressing
HTTP/2/gRPC specifically, and this research found no primary source resolving that question — but the
credential-gating point above is independently decisive regardless of that unresolved detail.

### Bottom line for Question 1

Omni's WireGuard-tunneled proxy is not a general-purpose network tunnel between cluster node networks, and
cannot be made into one — SideroLink's own point-to-point-only design (Talos's own words) forecloses that at
the transport layer, independent of anything Omni's application layer chooses to expose. What Omni's
application layer does expose is broader than "typical `kubectl` verbs" (both the raw discovery-endpoint GET
and, more generally, the newer workload-service-proxy feature prove that), but it is narrower than "any HTTP
GET": every path is scoped to a specific Omni-relayed feature (the API-server listener, or an explicitly
annotated Service) and is **always** gated behind an Omni-recognized credential. There is no mechanism,
confirmed directly by an Omni maintainer's own live test, for a genuinely anonymous, external caller with no
Omni credential to fetch a workload cluster's discovery document or JWKS through Omni's proxy today.

---

## Question 2: Is the ADR-0010-established LAN/`LoadBalancer` path actually viable for identity-discovery traffic?

### The mechanism is generic Kubernetes plumbing, not CNPG-specific

Kubernetes' own Service docs describe `type: LoadBalancer` in fully protocol-agnostic terms — there is
nothing in the mechanism that inspects or cares what's riding on top of the TCP/UDP connection it forwards:

> "LoadBalancer: Exposes the Service externally using an external load balancer. Kubernetes does not
> directly offer a load balancing component; you must provide one, or you can integrate your Kubernetes
> cluster with a cloud provider."
>
> "On cloud providers which support external load balancers, setting the type field to `LoadBalancer`
> provisions a load balancer for your Service. The actual creation of the load balancer happens
> asynchronously, and information about the provisioned balancer is published in the Service's
> `.status.loadBalancer` field... Traffic from the external load balancer is directed at the backend
> Pods. The cloud provider decides how it is load balanced. To implement a Service of `type:
> LoadBalancer`, Kubernetes typically starts off by making the changes that are equivalent to you
> requesting a Service of `type: NodePort`. The cloud-controller-manager component then configures the
> external load balancer to forward traffic to that assigned node port."

— [Kubernetes docs: Service](https://kubernetes.io/docs/concepts/services-networking/service/). Nothing here
is scoped to any particular application protocol — a `LoadBalancer` Service forwards whatever TCP/UDP traffic
arrives on its assigned port(s) to backend Pod IPs, whether that traffic is Postgres's wire protocol, a plain
HTTP GET for a JWKS mirror, or SPIRE's gRPC.

ADR 0010's own CNPG-side mechanism confirms this concretely rather than by inference. CloudNativePG's own
docs describe the `managed.services.additional` stanza this repo already uses as nothing more than a thin
pass-through to the ordinary Kubernetes Service API:

> "The `serviceTemplate` field gives you access to the standard Kubernetes API for the network Service
> resource, allowing you to define both the metadata and the spec sections as you like. You must provide
> a name to the service and avoid defining the selector field, as it is managed by the operator...
> **CloudNativePG has no control over the service configuration, except honoring the selector.**"

— [CloudNativePG docs: Service Management](https://cloudnative-pg.io/docs/devel/service_management), whose
own worked example for this exact "DBaaS, app and database in different Kubernetes clusters" scenario is
nothing more than `spec: type: LoadBalancer` on an ordinary `Service` object. There is no CNPG-specific
network facility here at all — CNPG only decides which Pods the Service's `selector` targets (`rw`, `ro`, or
`r`); the transport is stock Kubernetes. A JWKS-mirror `Service` on a workload cluster's own Istio Gateway (or
any ordinary `Service`), and a SPIRE Server's own `Service` on the platform cluster, generalize identically —
this is precisely the same reasoning ADR 0011's own already-accepted "Bypassing Omni's proxy for a direct
cluster credential" rejected-option writeup and #54's research both already assume for SPIRE ("SPIRE Agent→Server
communication... is ordinary gRPC to a Kubernetes Service — no different in kind from any other cross-cluster
app traffic," per #54's research, treated as fixed context here).

### Real infrastructure today, not merely theoretical — with one formality (not mechanism) still open

This repo's own sibling research, `docs/research/loadbalancer-talos-research.md`
([#46](https://github.com/aaronkyriesenbach/catalyst/issues/46), already closed), independently confirmed the
concrete mechanism ADR 0010 depends on:

- kube-vip's DaemonSet+ARP `LoadBalancer` implementation "carries over to Talos with no changes needed,
  confirmed both in kube-vip's own docs and in real Talos deployments reported in its issue tracker" — and
  is **already running in this repo today** (`cluster/kube-vip-daemonset.yaml`, `cluster/traefik-config.yaml`,
  the existing `192.168.53.201` Traefik VIP).
- The flat, unsubdivided Infra VLAN (`10.53.40.0/24`, [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5))
  already satisfies the one hard requirement ARP-mode L2 election needs (a shared broadcast domain) for every
  cluster's nodes "by construction," per that research.
- No capability, Talos-compatibility, or operational-maturity argument was found favoring an alternative tool
  (MetalLB) — if anything, MetalLB carries a confirmed, sourced Talos Pod-Security-Admission cost kube-vip
  (kept in the Talos-exempted `kube-system` namespace) does not.

The one genuinely open piece, per that same research, is a formal placement/tooling decision, not a viability
question: [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47) ("Decide how traffic reaches the
correct cluster across the multi-cluster ingress topology") remains an open ticket at the time of this
research, and Istio's own per-cluster Gateway `Service` (ADR 0009) has not yet been rolled out onto a live
multi-cluster Talos fleet (this repo's app layer still targets a single k3s cluster with Traefik as of this
research — `apps/traefik.ts`, no `apps/istio*.ts` yet). So: **the underlying LAN/`LoadBalancer` mechanism
this question asks about is proven, generic, already-running infrastructure** — what remains open is only
which specific tool continues to provide it on the new Talos/Omni fleet, and the timing of Istio's own
rollout, neither of which changes the answer to whether the mechanism itself is real. This repo's own
still-open [#49](https://github.com/aaronkyriesenbach/catalyst/issues/49) (how ESO on a workload cluster
reaches OpenBao's Service on the platform cluster) independently frames this as a general, non-CNPG-specific
question already — its own cover text asks about reachability "over whatever network path the cross-cluster
work generally uses — same LB/routing questions as #46/#47" — corroborating, from this repo's own forward
planning, that the LAN path is understood internally as a general-purpose mechanism, not a Postgres-specific
one-off.

### Applying this to both candidate designs

- **(a) JWKS-mirror service on a workload cluster, reachable by a platform-cluster broker**: an ordinary
  in-cluster app (not the API server itself) exposed via that cluster's own Istio Gateway/`LoadBalancer`
  Service, on the same flat LAN every cluster's nodes already share. Mechanically identical to CNPG's `rw`
  Service — a JWKS document over plain HTTP is a strictly simpler payload than Postgres's own wire protocol.
- **(b) SPIRE Agent (workload cluster) reaching a SPIRE Server exposed the same way (platform cluster)**:
  identical reasoning — an ordinary gRPC `Service`, `type: LoadBalancer`, no different in kind from any other
  cross-cluster app traffic, matching #54's already-established finding (treated as fixed context here, not
  re-derived).

Both are viable, and viable via the same, already-proven mechanism this repo already runs for a different
purpose today.

---

## Question 3: Does either mechanism family still need Omni's proxy for anything else?

### Broker + JWKS mirror: Omni's proxy is needed only for the same, already-accepted reason every app needs it

Once the JWKS-mirror app is deployed, its actual identity-discovery traffic (the platform-cluster broker
fetching the mirror's re-served document) rides entirely over the ADR-0010-style LAN path — no Omni
involvement at all, per Question 2. The mirror app's *own* act of retrieving the local discovery document
from its own cluster's kube-apiserver is likewise entirely in-cluster traffic — Kubernetes' own
`ServiceAccountIssuerDiscovery` RBAC binding (`system:service-account-issuer-discovery` → `system:serviceaccounts`,
confirmed directly against Kubernetes' own docs, matching #56's already-established finding) already permits
this from inside the cluster, with no external reachability question raised at all — ADR 0011's
Omni-proxy-only restriction is specifically about reaching a cluster's API server from *outside* that cluster,
which the mirror design never needs to do for its own fetch.

The **only** Omni-proxy dependency this design has is the same one every single app in this repo already has,
per ADR 0007/0011: the mirror app itself has to be deployed and kept in sync onto the workload cluster by the
platform cluster's GitOps hub, and ADR 0011 already establishes that "the hub's ongoing reconciliation of both
workload clusters depends on the Management host's uptime" (`CONTEXT.md`, GitOps hub entry). This is not a new
or identity-specific dependency — it is the pre-existing, already-accepted cost of running *any* app on a
workload cluster in this repo's architecture, unrelated to which machine-identity mechanism #55 eventually
picks.

### SPIRE: the practically-relevant node attestor introduces a genuine, ongoing, identity-specific Omni-proxy dependency

SPIRE's `k8s_psat` node attestor — the option #54's research already identified as "the practically relevant
one" for Talos, since it validates entirely through the Kubernetes API rather than any cloud- or
OS-specific mechanism — has a server-side configuration requirement that matters directly here:

> "`kube_config_file` — Path to a k8s configuration file for API Server authentication. **A kubernetes
> configuration file must be specified if SPIRE server runs outside of the k8s cluster.** If empty, SPIRE
> server is assumed to be running inside the cluster and in-cluster configuration is used."
>
> "The Kubernetes user defined in the kube config file needs to have ClusterRoleBindings assigned to
> ClusterRoles containing at least the following permissions:
> ```yaml
> - apiGroups: [""]
>   resources: ["pods", "nodes"]
>   verbs: ["get"]
> - apiGroups: ["authentication.k8s.io"]
>   resources: ["tokenreviews"]
>   verbs: ["create"]
> ```"

— [SPIRE server plugin: NodeAttestor
"k8s_psat"](https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_server_nodeattestor_k8s_psat.md). In this
repo's topology (SPIRE Server on the platform cluster; SPIRE Agents on the External and Internal workload
clusters), the SPIRE Server is, from each workload cluster's own point of view, exactly the "SPIRE server runs
outside of the k8s cluster" case this doc describes — meaning the SPIRE Server needs its own, ongoing
`kube_config_file`-backed credential authorized to call **`tokenreviews: create`** against each workload
cluster's actual Kubernetes API server, every time an Agent (re-)attests (initial join, and any subsequent
re-attestation after an Agent restart). This is unambiguously "authenticated Kubernetes-API-server traffic" in
exactly the sense ADR 0011 already restricts — not ordinary app-to-app `Service` traffic — and per ADR 0011,
the *only* way to reach a workload cluster's Kubernetes API server externally at all is Omni's WireGuard-tunneled
proxy. Adopting the ADR-0010-style LAN path for the Agent↔Server SVID-issuance gRPC channel (Question 2) does
**not** remove this separate, ongoing dependency — node attestation and SVID issuance are two different network
calls in SPIRE's own design, and only the latter is ordinary app traffic.

The one documented escape hatch, already flagged by #54's research: SPIRE's `join_token` node attestor (a
one-time pre-shared secret between Server and Agent) requires no TokenReview call at all, and therefore no
per-cluster Kubernetes-API credential — at the cost of the manual per-node registration burden #54's research
already identified as `join_token`'s own tradeoff.

### Net asymmetry for #55

- **Broker + JWKS mirror**: Omni's proxy is needed only for the same, generic, already-accepted GitOps-deployment
  reason every app in this repo needs it — nothing identity-specific.
- **SPIRE** (using `k8s_psat`, the practically-relevant attestor per #54): Omni's proxy is needed for that same
  generic GitOps-deployment reason, **plus** an ongoing, identity-specific dependency — the SPIRE Server's own
  cross-cluster TokenReview calls for node attestation — that has no equivalent in the broker family at all,
  unless SPIRE instead adopts `join_token` and accepts its manual-registration cost.

This is a real, sourced operational-cost difference between the two mechanism families that neither #54 nor
#56 fully surfaced (both treated Agent↔Server traffic as settled without separately tracing node-attestation's
own network path) — directly relevant to #55's comparison.

---

## Question 4: Does Omni have any newer, more direct capability for this?

### The previously-cited feature request remains open, unimplemented, and is the wrong direction anyway

[siderolabs/omni#2663](https://github.com/siderolabs/omni/issues/2663) ("Allow external OIDC tokens to
authenticate to Omni (GitHub Actions, cloud workload identity)") — the issue ADR 0011 and #54's research
already cite — remains **open**, with exactly one follow-up comment since its creation (2026-04-10, from a
Sidero Labs maintainer: **"I wonder if we should layer this on top of SA to reduce the risk of SA leaks, and
simply issue temporary SA in exchange for OIDC token"**), no linked PR, and no milestone. Its own body is
explicit that this is the wrong direction for this ticket's question regardless of implementation status:
**"This is the opposite direction: external systems authenticating to Omni"** — i.e., letting CI/CD or cloud
workload-identity clients authenticate *to Omni's own API* (replacing a static Service Account key), not Omni
exposing a workload cluster's own OIDC issuer *outward* to external relying parties.

### The right-direction issue exists, is genuinely new to this research thread, and is also unimplemented

[siderolabs/omni#2266](https://github.com/siderolabs/omni/issues/2266) ("[feature] Provide OIDC URI for
service account token issuer") is the issue that actually matches this ticket's question — and it is new
information to this research thread specifically: neither #54's nor #56's research documents cite it. Its
own problem statement:

> "When using a cloud platform and trying to add trust to the Omni OIDC they require an endpoint issuer to
> set as trusted. This endpoint is not available to customers... Provide a way to fetch the cluster OIDC
> issuer URI."

As covered in Question 1, this issue's comment thread contains the most concrete, primary-source-verified
technical detail found anywhere in this research: a live confirmation of today's limitation (the discovery
document already traverses Omni's proxy for an authenticated caller, but resolves to internal-only addresses),
and a from-a-maintainer engineering sketch of the fix:

> "1. Proxy two unauthenticated endpoints per cluster (the discovery document and the JWKS). Forward
> through SideroLink to the kube-apiserver. The content is public information (just public keys). 2. The
> `--service-account-issuer` needs to be set to the Omni proxy URL so new tokens have the right `iss`
> claim... 3. The `jwks_uri` in the proxied discovery document still points to an internal kube-apiserver
> IP, so that needs to be rewritten to point to the Omni proxy URL... This is orthogonal to Omni's own
> auth. K8s SA tokens are a completely separate trust domain. Omni would just be proxying two public
> endpoints... Bounded work with existing infrastructure."

— [siderolabs/omni#2266, comment by
`utkuozdemir`](https://github.com/siderolabs/omni/issues/2266#issuecomment-4224152215). This is a real,
credible design — not vaporware — but it remains **exactly that: a design comment, not shipped code.** There
is no linked pull request, no release-note mention in any Omni release found by this research (through
v1.10.3, the latest at research time), and no committed milestone. The issue is a child of
[siderolabs/omni#3207](https://github.com/siderolabs/omni/issues/3207) ("support service account
customization"), itself an open, loosely-scoped backlog issue ("Links to some stories which can be implemented
right now for Talos 1.14+") with no timeline of its own. **If this ships as designed, it would directly close
Question 1's current gap** — Omni's proxy would then carry a genuinely public, unauthenticated discovery/JWKS
endpoint per cluster, removing the need for either mechanism family's own JWKS-mirror/cross-cluster-attestation
workaround for the *outbound-to-AWS* case specifically. But it does not exist today, and this research found no
evidence it is imminent.

### Recent Omni releases checked directly; nothing else moves the needle

This research checked Omni's own release notes from v1.6.0 (2026-03-16) through the latest, v1.10.3
(2026-08-14), for any shipped OIDC/JWKS/service-account/workload-identity capability. The one directly
relevant item found tightens rather than loosens the picture #54 already established:

> "Config patches can no longer set the Kubernetes certificate authority or the service account signing
> key, which Omni generates and owns. This holds for every cluster, not only for clusters on the new
> Talos 1.14 document layout, and it covers the v1alpha1 fields as well as the Talos 1.14 documents that
> carry the same material."

— [Omni v1.10.0 release notes](https://github.com/siderolabs/omni/releases/tag/v1.10.0). This is Omni now
actively *rejecting*, not merely silently stripping, config-patch attempts against `cluster.serviceAccount` and
CA fields — corroborating, not contradicting, #54's earlier finding that this field is fully reserved by Omni
(the self-hosted-IRSA path #54 already ruled out for this reason remains ruled out, more firmly than before).
Nothing else in the release notes surveyed (workload-proxy multi-host-port support in 1.8.0, the new `Auditor`
role in 1.10.0, various dependency bumps) bears on this ticket's specific cross-cluster identity-discovery
question.

### Bottom line for Question 4

No newer, more direct Omni capability exists today. The one previously-cited feature request (#2663) remains
open, unimplemented, and is the wrong direction regardless. The right-direction request (#2266) — genuinely
new information this research surfaces — is also open and unimplemented, but now has a credible engineering
sketch behind it; this is worth tracking as a future upgrade path (consistent with ADR 0011's own framing of
Omni's not-yet-shipped federation capability as "a natural upgrade path if Omni ships it, not a redesign"), not
something #55 can rely on today.

---

## Recommendation

None — by design. This ticket's own instructions, and the wayfinder map's split between research and grilling
tickets, place any actual mechanism decision in the resumed grilling session in
[#55](https://github.com/aaronkyriesenbach/catalyst/issues/55). What this research contributes to that
session:

- Omni's WireGuard-tunneled proxy cannot be a general cross-cluster tunnel for identity-discovery traffic —
  confirmed structurally (SideroLink is point-to-point only, per Talos's own docs) and empirically (a live
  Omni maintainer's own test shows the discovery/JWKS endpoints resolve to internal-only addresses,
  unreachable outside an already-authenticated Omni session, with no anonymous path today).
- The ADR-0010-established LAN/`LoadBalancer` path is real, generic, already-running infrastructure in this
  repo (kube-vip's proven Talos-compatible ARP mechanism, per #46's closed research) and generalizes cleanly
  to a JWKS-mirror Service or a SPIRE Server Service — confirmed against Kubernetes' own docs and CNPG's own
  docs as containing no CNPG-specific magic. The only open piece is a tooling/placement formality (#47), not
  a viability question.
- The two mechanism families are **not symmetric** on their remaining Omni-proxy dependency: a broker + JWKS
  mirror design needs Omni's proxy only for the same generic reason every app does (GitOps deployment); SPIRE
  (using its practically-relevant `k8s_psat` attestor) has an additional, ongoing, identity-specific
  dependency — the SPIRE Server's own cross-cluster TokenReview calls for node attestation — unless it instead
  adopts the manual-registration `join_token` attestor. This is new, sourced information #55 should weigh.
- Nothing newer or more direct has shipped from Omni for this specific problem. The previously-known feature
  request (#2663) remains open and is the wrong direction; a second, right-direction request (#2266) —new to
  this research thread — is also open, with a credible but unimplemented engineering sketch, worth tracking as
  a future upgrade path rather than a present option.

---

## Sources

**Sidero Omni — docs**

- What is Omni? — <https://docs.siderolabs.com/omni/overview/what-is-omni.md>
- Use Kubectl With Omni — <https://docs.siderolabs.com/omni/getting-started/use-kubectl-with-omni.md>
- Machine Registration (SideroLink) — <https://docs.siderolabs.com/omni/infrastructure-and-extensions/machine-registration.md>
- Omni, Talos, and Kubernetes Security (security model, service accounts) — <https://docs.siderolabs.com/omni/security-and-authentication/security-model.md>
- Authentication and Authorization — <https://docs.siderolabs.com/omni/security-and-authentication/authentication-and-authorization.md>
- Expose a Workload via Service Proxy — <https://docs.siderolabs.com/omni/cluster-management/expose-a-workload-via-service-proxy.md>
- Enable Workload Proxy (self-hosted) — <https://docs.siderolabs.com/omni/self-hosted/enable-workload-proxy.md>
- How configuration works in Omni (reserved/dedicated-resource/patchable field partition) — <https://docs.siderolabs.com/omni/omni-cluster-setup/how-configuration-works-in-omni.md>
- Talos Config Overrides — <https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md>
- Create a Kubeconfig for a Kubernetes Service Account — <https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-kubeconfig-for-a-service-account.md>
- Talos/Omni docs index (`llms.txt`) — <https://docs.siderolabs.com/llms.txt>

**Sidero Omni — GitHub (issues, releases)**

- siderolabs/omni#2663 "Allow external OIDC tokens to authenticate to Omni (GitHub Actions, cloud workload identity)" — <https://github.com/siderolabs/omni/issues/2663>
- siderolabs/omni#2266 "[feature] Provide OIDC URI for service account token issuer" (comment thread with the `kubectl get --raw` verification and proxy design sketch) — <https://github.com/siderolabs/omni/issues/2266>
- siderolabs/omni#3207 "support service account customization" (parent backlog issue for #2266) — <https://github.com/siderolabs/omni/issues/3207>
- Omni releases index — <https://github.com/siderolabs/omni/releases>
- Omni v1.10.0 release notes (Kubernetes CA / service-account-key rejected in config patches) — <https://github.com/siderolabs/omni/releases/tag/v1.10.0>
- Omni v1.9.0, v1.8.0 release notes (checked, no directly relevant capability) — <https://github.com/siderolabs/omni/releases/tag/v1.9.0>, <https://github.com/siderolabs/omni/releases/tag/v1.8.0>

**Talos Linux — docs**

- SideroLink (point-to-point overlay, no direct machine-to-machine traffic) — <https://docs.siderolabs.com/talos/v1.13/networking/siderolink.md>

**Kubernetes — docs**

- Service (`type: LoadBalancer`, generic external-LB mechanics) — <https://kubernetes.io/docs/concepts/services-networking/service/>
- Configure Service Accounts for Pods — ServiceAccount issuer discovery (RBAC scope, `system:service-account-issuer-discovery`) — <https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/>

**CloudNativePG — docs**

- Service Management (`managed.services.additional`, `serviceTemplate`, `type: LoadBalancer` worked example) — <https://cloudnative-pg.io/docs/devel/service_management>

**SPIFFE / SPIRE — docs**

- SPIRE server plugin: NodeAttestor "k8s_psat" (`kube_config_file`, cross-cluster TokenReview RBAC requirements) — <https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_server_nodeattestor_k8s_psat.md>

**catalyst repo (current-state context, treated as fixed inputs per this ticket's own instructions)**

- `docs/adr/0009-ingress-istio-no-mesh-span.md` — Istio Gateway per cluster, no mesh span, LoadBalancer-implementation deferral
- `docs/adr/0010-dbaas-provisioning-connectivity.md` — CNPG-native `LoadBalancer` cross-cluster connectivity precedent
- `docs/adr/0011-cluster-registration-cross-cluster-auth.md` — Omni WireGuard-only Kubernetes-API-server reachability; `siderolabs/omni#2663` cited there
- `docs/adr/0012-omni-deployment-model-availability.md` — Omni single-VM availability tradeoff, "external access only" framing
- `CONTEXT.md` — GitOps hub / Management host / Workload cluster terminology
- `docs/research/machine-identity-research.md` (branch `research/machine-identity-research`, [#54](https://github.com/aaronkyriesenbach/catalyst/issues/54)) — SPIRE `k8s_psat` node attestation, SPIRE Agent↔Server-as-ordinary-gRPC finding (treated as fixed context)
- `docs/research/identity-broker-machine-identity-research.md` (branch `research/identity-broker-machine-identity-research`, [#56](https://github.com/aaronkyriesenbach/catalyst/issues/56)) — broker/JWKS-mirror framing, `ServiceAccountIssuerDiscovery` RBAC-scope finding (treated as fixed context)
- `docs/research/loadbalancer-talos-research.md` (branch `research/loadbalancer-talos-research`, [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46), closed) — kube-vip/Talos viability, flat-VLAN L2 adjacency, no case found for MetalLB
- `cluster/kube-vip-daemonset.yaml`, `cluster/traefik-config.yaml` — this repo's already-running `LoadBalancer` precedent
- `apps/traefik.ts` — current app-layer state (Istio not yet rolled out as of this research)
- catalyst repo issues consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1) (wayfinder map), [#5](https://github.com/aaronkyriesenbach/catalyst/issues/5) (network segmentation, flat Infra VLAN), [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46) (LoadBalancer research, closed), [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47) (traffic-routing/LB-tooling decision, open), [#49](https://github.com/aaronkyriesenbach/catalyst/issues/49) (cross-cluster OpenBao/ESO reachability, open, same LB-path framing), [#54](https://github.com/aaronkyriesenbach/catalyst/issues/54) (machine-identity research, closed), [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55) (grilling ticket this research feeds), [#56](https://github.com/aaronkyriesenbach/catalyst/issues/56) (identity-broker research, closed)
