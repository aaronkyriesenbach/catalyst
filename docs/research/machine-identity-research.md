# Research: workload/machine-identity mechanisms for a multi-cluster Kubernetes platform

**Ticket**: [#54](https://github.com/aaronkyriesenbach/catalyst/issues/54) — feeds
[Decide machine-identity mechanism for workload identity across the multi-cluster platform
(#55)](https://github.com/aaronkyriesenbach/catalyst/issues/55), and by extension
[#47](https://github.com/aaronkyriesenbach/catalyst/issues/47) (external-dns's Route53 auth) and
[#49](https://github.com/aaronkyriesenbach/catalyst/issues/49) (cross-cluster OpenBao/ESO
reachability) — part of the ["Homelab platform rearchitecture" wayfinder
map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: per #54, this repo already has OpenBao (ADR 0004) as the app-layer secrets *store* (a
consumer of workload identity, not the mechanism itself), an existing self-hosted IRSA pattern
(`irsa.md`) written for the pre-rearchitecture single k3s cluster, Istio in ambient mode already
issuing every in-mesh workload a SPIFFE-format identity for its own mTLS purposes (ADR 0009,
#21/#36 — independent per-cluster root CAs, no mesh span), and Talos + self-hosted Sidero Omni as the
cluster-lifecycle layer (#7), every cluster reachable externally only through Omni's own WireGuard
proxy (ADR 0011). This document investigates, against primary sources, whether SPIFFE/SPIRE as a
dedicated control plane, reusing Istio's existing SPIFFE identities, OpenBao's own auth methods,
this repo's existing self-hosted-IRSA pattern, and cloud-native/production prior art fit that
context — **it does not decide anything**, per this ticket's own instructions; the decision is
deferred to the grilling session in [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55).

---

## TL;DR

- **SPIFFE/SPIRE has a real, Talos-compatible node-attestation path today, but it's a second control
  plane with its own operational surface, not a thin add-on.** The Kubernetes Projected Service
  Account Token (`k8s_psat`) node attestor works entirely through the Kubernetes API — it "attests
  nodes running inside of Kubernetes" by validating a signed token via the [Kubernetes Token Review
  API](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.19/#tokenreview-v1-authentication-k8s-io),
  with no dependency on the underlying OS or cloud IMDS — so it works identically on Talos as on any
  other Kubernetes distribution. But SPIRE's own scaling docs show that even the smallest documented
  reference deployment (10 workloads, 10 agents) is sized as **"2 Server Units with 1 CPU core, 1GB
  RAM"** — SPIRE's own HA guidance treats a 2-server topology as the floor, not an upgrade path — and
  its recommended Helm chart layout requires a second namespace (`spire-system`, for the Agent and
  the SPIFFE CSI driver) pinned to the **`Privileged`** Kubernetes Pod Security Standard, the same
  category of Talos PSA friction this repo's sibling research
  (`docs/research/loadbalancer-talos-research.md`) already found for MetalLB, not kube-vip.
- **Istio ambient's SPIFFE identity is architecturally built for transparent ztunnel-to-ztunnel
  mTLS, not for a workload to present as its own portable credential to an outside party.** Istio's
  own ambient-architecture docs state plainly that **"the ztunnel proxy also obtains mTLS
  certificates for the Service Accounts of all pods that are scheduled on its Kubernetes node using
  xDS"** — the certificate and private key live in ztunnel, on the node, never in the application
  container. This is the opposite of SPIRE's own design, whose use-case docs describe workloads
  **"retriev[ing] and interact[ing] with these keys and certificates directly"** via the SPIFFE
  Workload API. Istio's own deployment-models docs confirm cross-mesh trust is possible in principle
  via **"a protocol such as [SPIFFE Trust Domain
  Federation](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Federation.md)"**, but add
  immediately: **"Istio does not provide any tooling to exchange trust bundles across meshes."**
  Istio does have a first-party SPIRE integration, but it runs in the opposite direction from what
  #54 asks: it lets **SPIRE issue Istio's own workload certificates** (via Envoy's SDS API), not a
  way for OpenBao or AWS to validate an Istio-issued identity as a relying party.
- **OpenBao's current auth-method list, confirmed against its own docs rather than assumed from
  upstream Vault, is narrower than Vault's and has no SPIFFE-specific integration at all.** The
  complete list found in OpenBao 2.6.x's own docs navigation is: AppRole, TLS Certificates (`cert`),
  JWT/OIDC (`jwt`), Kerberos, Kubernetes, LDAP, Login MFA, RADIUS, Token, and Userpass — **no `aws`,
  `azure`, `gcp`, `github`, or `okta` auth methods appear anywhere in OpenBao's docs**, a genuine
  fork divergence from HashiCorp Vault. Neither `spiffe` nor `SPIFFE` appears anywhere in OpenBao's
  `jwt` or `cert` auth-method docs. That said, both the generic `jwt` method (arbitrary
  `oidc_discovery_url`) and the generic `cert` method (`allowed_uri_sans` glob-matching on the
  certificate's URI SAN) are structurally capable of validating a SPIFFE JWT-SVID or X.509-SVID
  respectively — OpenBao just doesn't brand or document them that way.
- **This repo's existing self-hosted-IRSA pattern is fully supported on bare Talos — Talos has a
  first-party, dedicated doc for it — but hits a hard wall on Omni specifically, this repo's actual
  cluster-lifecycle tool.** Talos's own ["IRSA with Talos
  Linux"](https://docs.siderolabs.com/talos/v1.13/security/iam-roles-for-service-accounts.md) guide
  uses the exact same mechanism as `irsa.md`'s k3s recipe, expressed as Talos machine-config fields:
  `cluster.apiServer.extraArgs.service-account-issuer` and `cluster.serviceAccount.key`. But Omni's
  own docs on ["How configuration works in
  Omni"](https://docs.siderolabs.com/omni/omni-cluster-setup/how-configuration-works-in-omni.md)
  list `cluster.serviceAccount` — the exact field carrying the custom signing keypair IRSA
  needs — under **"Reserved by Omni"**, fields where **"patch attempts... are either rejected with a
  `MergeDenied` error or silently stripped during reconciliation."** Omni's separate ["Talos Config
  Overrides"](https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md)
  reference page (the one consulted in the sibling load-balancer research) does not list
  `cluster.serviceAccount` at all — the two Omni docs pages disagree on completeness, and this
  research treats the more detailed, more recently-styled "How configuration works" page as
  authoritative, while flagging the discrepancy rather than silently picking one.
- **AWS IRSA and Azure Workload Identity both require a publicly internet-reachable OIDC discovery
  endpoint; GCP's Workload Identity Federation is the outlier and does not.** AWS's own EKS docs
  state IRSA needs **"a public OIDC discovery endpoint for each cluster... so external systems, such
  as IAM, can validate."** Azure's own docs describe the identical requirement (`{IssuerURL}/openid/v1/jwks`
  fetched directly by Microsoft Entra ID). GCP's own IAM docs describe a third option none of the
  others have: **"To federate workloads that don't have a public OIDC endpoint, you can upload OIDC
  JSON Web Key Sets (JWKS) directly to the pool"** — no public reachability required at all. This
  matters directly for this repo: every Omni-managed cluster is reachable externally **only** through
  Omni's own WireGuard proxy (ADR 0011, already flagged in that ADR as blocking any future
  Omni-native machine-identity federation), so any AWS- or Azure-style approach (including SPIRE's
  own AWS OIDC-federation tutorial, which requires the same public reachability) needs a separate,
  Omni-independent public HTTPS endpoint regardless of which identity mechanism is chosen.
- **A unified, single identity across all three clusters is achievable via SPIRE (one trust domain,
  one OIDC Discovery Provider, one AWS IAM OIDC Identity Provider registration) but not via
  Istio-ambient-reuse or via this repo's existing per-cluster IRSA pattern as documented.** IRSA's
  issuer identity is inherently cluster-local (one signing key, one issuer URL, one IAM OIDC
  provider per cluster) — three clusters would mean three independent bootstraps, exactly the "N
  separate per-cluster federations" #55 is trying to avoid. Istio-reuse is blocked by the key-custody
  problem above *and* compounded by ADR 0009's independent-per-cluster-root-CA decision (no shared
  trust domain even if the key-custody problem were solved). SPIRE, run as one trust domain spanning
  all three clusters (a documented topology — SPIRE's own scaling docs describe "Single Trust
  Domain," "Nested SPIRE," and "Federated SPIRE" as three explicit, named options), is the one
  option surveyed that can present one issuer to both OpenBao and AWS instead of three.
- **Production/enterprise material on SPIFFE/SPIRE is real and CNCF-graduated but skews toward
  large, dedicated-security-team organizations, not small-scale self-hosted homelab fleets.** SPIFFE
  is a CNCF **Graduated** project. SPIFFE's own case-studies page (curated conference talks, not
  blog opinion) documents production use at GitHub, Uber, Square/Block, ByteDance/TikTok, Pinterest,
  Bloomberg-adjacent financial firms (TransferWise), and others — but every cited deployment is at a
  scale with a dedicated platform/security team, multiple data centers or clouds, and thousands of
  workloads; this research found no primary-source case study describing SPIRE at a single-operator,
  few-cluster, on-prem homelab scale. Per-cluster OIDC federation (the IRSA/Azure-Workload-Identity
  pattern) remains the default *hyperscaler-native* answer at any scale, precisely because each
  hyperscaler already runs the OIDC-issuer side of that protocol for you inside their own managed
  Kubernetes offering — the "do it yourself across N self-hosted clusters" problem this repo actually
  has is a narrower, less-documented case that none of the primary sources surveyed address directly.

---

## Question 1: SPIFFE/SPIRE as a dedicated workload-identity control plane

### What it actually is and does

SPIFFE (the specification) and SPIRE (its production-ready reference implementation) are described,
in SPIRE's own docs, as performing **"node and workload attestation in order to securely issue SVIDs
to workloads, and verify the SVIDs of other workloads, based on a predefined set of conditions"** —
[SPIRE Concepts](https://spiffe.io/docs/latest/spire-about/spire-concepts/). A deployment is
composed of a **SPIRE Server** (the signing authority and registry of workload-identity conditions)
and one or more **SPIRE Agents**, one per node, which "expose the SPIFFE Workload API locally to
workloads" and "must be installed on each node on which a workload is running" (same source).

Two attestation phases matter here, per the same doc:

- **Node attestation** first proves the identity of the machine the agent runs on — "the result of a
  successful node attestation is that the agent receives a unique SPIFFE ID" which becomes the
  parent of every workload it's responsible for.
- **Workload attestation** then asks "who is this process?" by interrogating the local kernel or
  kubelet and comparing the answer against pre-registered selectors.

### Node attestation options relevant to Talos

SPIRE's server config reference lists the complete set of built-in node attestor plugins:
`aws_iid`, `azure_imds`, `azure_msi`, `gcp_iit`, `join_token`, `k8s_psat`, `sshpop`, `tpm_devid`, and
`x509pop` — [SPIRE Server Configuration
Reference](https://spiffe.io/docs/latest/deploying/spire_server/). None of these is Talos-specific,
but `k8s_psat` is the practically relevant one for this repo's stack, because it operates entirely
through the Kubernetes API rather than the underlying OS or a cloud metadata service:

> "The `k8s_psat` plugin attests nodes running inside of Kubernetes... This validation is performed
> using Kubernetes [Token Review
> API](https://kubernetes.io/docs/reference/generated/kubernetes-api/v1.19/#tokenreview-v1-authentication-k8s-io)."

— [SPIRE server plugin: NodeAttestor
"k8s_psat"](https://raw.githubusercontent.com/spiffe/spire/v1.15.2/doc/plugin_server_nodeattestor_k8s_psat.md).
Because it validates a projected service-account token via Kubernetes' own TokenReview API, it works
identically whether the node runs Talos, a cloud-managed distro, or anything else — this research
found no Talos-specific SPIRE node attestor, and none is needed for this mechanism to work. The
simplest universal fallback, `join_token` (a one-time pre-shared secret between server and agent,
which "expire[s] immediately after use" — [SPIRE
Concepts](https://spiffe.io/docs/latest/spire-about/spire-concepts/)), also works on any OS
including Talos, at the cost of manual per-node registration. `tpm_devid` (attesting via a
TPM provisioned with a DevID certificate) is a theoretical third option this research did not find
documented as tested against Talos specifically — Talos's own TPM-related docs were not part of this
research's verified source set, so this option is noted but not confirmed either way.

### Operational footprint

SPIRE's own planning docs give concrete sizing guidance, and even the smallest listed reference
deployment assumes a two-server topology, not a single instance:

> "Number of Workloads | 10 Agents ... 10 Workloads | 2 Server Units with 1 CPU core, 1GB RAM"

— [Scaling SPIRE](https://spiffe.io/docs/latest/planning/scaling_spire/). The same doc explains why:
"a single instance of a SPIRE Server also represents a single point of failure," so SPIRE's own
guidance treats HA as the starting point, not an upgrade path reserved for scale. HA also requires a
**shared SQL datastore** across all server instances — "configure all servers in same trust domain
to read and write to the same shared datastore... SQLite is bundled with SPIRE Server and is the
default datastore. A number of compatible SQL databases are supported... including... PostgreSQL"
(same doc). This is a genuine, non-trivial new stateful dependency in isolation, but it composes
cleanly with what this repo has already decided: CloudNativePG is already the platform cluster's
database-as-a-service fleet (ADR 0006), so a SPIRE deployment would not need to introduce a new kind
of database, only a new CNPG-hosted database.

SPIRE's own recommended Helm chart layout ("hardened" charts) also has a direct Pod Security
Admission cost on Talos, the same category of friction this repo's sibling research
(`docs/research/loadbalancer-talos-research.md`) already documented for MetalLB (not for kube-vip,
which stays in the Talos-exempted `kube-system` namespace):

> "Namespace Type | Namespace Value | ... | Purpose — Server | `spire-server` | Services that should
> have restricted Kubernetes privileges — System | `spire-system` | Services needing Kubernetes
> privileges" ... "On creation, the following Namespaces are assigned their Pod Security Standard:
> Server | Restricted — System | **Privileged**"

— [SPIRE Helm Charts Hardened:
Recommendations](https://spiffe.io/docs/latest/spire-helm-charts-hardened-about/recommendations/).
The SPIRE Agent and the [SPIFFE CSI driver](https://github.com/spiffe/spiffe-csi) (used to mount the
Envoy-compatible SDS socket into proxies, "strongly recommended by both Istio and SPIRE" per Istio's
own SPIRE integration guide, covered below) both live in that `spire-system` namespace — meaning, on
Talos, this namespace would need an explicit PSA `privileged` label override, the same category of
friction the sibling research found to be a real, sourced cost for MetalLB and not for kube-vip
(which Talos exempts by default because it lives in `kube-system`).

### Fitting a self-hosted Talos+Omni multi-cluster deployment, and proportionality

Nothing in SPIRE's own docs describes it as depending on any single Kubernetes distribution's
extension mechanism, so nothing here is Talos- or Omni-specific beyond the node-attestation and PSA
points above. SPIRE's own topology docs name three deployment shapes explicitly — **Single Trust
Domain**, **Nested SPIRE**, and **Federated SPIRE**
([Scaling SPIRE](https://spiffe.io/docs/latest/planning/scaling_spire/)) — any of which could in
principle span this repo's three clusters, with Single Trust Domain being the simplest fit for "one
unified identity" (see Question 5).

This research did not find a primary source stating a clear proportionality verdict either way for
a single-operator, three-cluster homelab scale — SPIRE's own docs are written for the "tens of
thousands to hundreds of thousands of nodes" end of the spectrum
([Scaling SPIRE](https://spiffe.io/docs/latest/planning/scaling_spire/)) as much as the small end,
and the case-study material (Question 5) is uniformly at a much larger organizational scale than
this repo's. What this research can state concretely: SPIRE is a second, independent control plane
(its own Server, its own Agent DaemonSet, its own datastore, its own namespace/PSA considerations,
its own registration-entry maintenance burden) layered *on top of* Istio ambient's mesh (already
adopted) rather than replacing anything already decided — it is additive operational surface, not a
substitute for something this repo already runs.

---

## Question 2: Reusing Istio ambient's existing SPIFFE identities directly

### How ambient's identity issuance actually works

Istio's own ambient-architecture docs describe exactly who holds the certificate and private key in
ambient mode, and it is not the application:

> "The ztunnel proxy uses xDS APIs to communicate with the Istio control plane (`istiod`)... The
> ztunnel proxy also obtains mTLS certificates for the Service Accounts of all pods that are
> scheduled on its Kubernetes node using xDS. A single ztunnel proxy may implement L4 data plane
> functionality on behalf of any pod sharing its node... This multi-tenant architecture contrasts
> sharply with the sidecar model where each application pod has its own proxy."

— [Ambient and the Istio control
plane](https://istio.io/latest/docs/ambient/architecture/control-plane/). This is the structural
crux of Question 2: the workload process itself never holds its own SPIFFE X.509-SVID private key in
ambient mode. Istio's own `AuthorizationPolicy` mechanism does consume the identity — L4 policy rules
can match on `source.principals` such as `cluster.local/ns/ambient-demo/sa/curl` — but this is
enforced entirely between the sending and receiving **ztunnel** (or **waypoint**) proxies, described
explicitly as "the enforcement point is the receiving (server-side) ztunnel proxy in the path of a
connection" — [Use Layer 4 security
policy](https://istio.io/latest/docs/ambient/usage/l4-policy/). This is fundamentally different
from SPIRE's own design intent, where the SPIFFE Workload API exists specifically so a workload can
"retrieve and interact with these keys and certificates directly" to establish its own mTLS
connections, or "generate or verify JWTs... via the Workload API" — [SPIRE Use
Cases](https://spiffe.io/docs/latest/spire-about/use-cases/). Istio ambient has no equivalent
workload-facing API for handing the application its own portable credential.

One partial exception exists at Layer 7 only: Istio's mesh config supports propagating the verified
peer certificate to the upstream application over HTTP via the `X-Forwarded-Client-Cert` (XFCC)
header, controlled by `ForwardClientCertDetails`
(`APPEND_FORWARD` is the sidecar default) —
[`istio.mesh.v1alpha1`
reference](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/). This requires an L7
hop (a waypoint in ambient mode, since ztunnel is L4-only and cannot set HTTP headers), and it
exposes the caller's identity as an HTTP header for the destination app to read and trust — it is
not a portable bearer credential the app can present onward to a *third* party like OpenBao or AWS.

### Federation and external validation, per Istio's own docs

Istio's own deployment-models docs address cross-mesh/external trust directly, and are explicit
about the gap between the *protocol existing* and Istio *shipping tooling for it*:

> "To enable communication between two meshes with different CAs, you must exchange the trust
> bundles of the meshes. **Istio does not provide any tooling to exchange trust bundles across
> meshes.** You can exchange the trust bundles either manually or automatically using a protocol
> such as [SPIFFE Trust Domain
> Federation](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE_Federation.md)."

— [Deployment Models: Trust between
meshes](https://istio.io/latest/docs/ops/deployment/deployment-models/#trust-between-meshes). Istio's
own `MeshConfig` reference confirms the mechanical piece that *would* support this: `trustDomain`
"corresponds to the trust root of a system" per the SPIFFE-ID spec, and a `CertificateData` trust
anchor can be sourced from a `spiffeBundleUrl` — "The SPIFFE bundle endpoint URL that complies to...
[the SPIFFE Trust Domain and Bundle spec]... The certificate is retrieved from the endpoint" —
[`istio.mesh.v1alpha1` reference](https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/).
So Istio *can consume* a foreign SPIFFE bundle endpoint as a trust anchor — but nothing in Istio's
own docs describes Istio *hosting* a bundle endpoint of its own for external, non-Istio verifiers
(like OpenBao or AWS) to fetch its root/intermediate CA from. Combined with ADR 0009's own decision
(independent per-cluster root CAs, no shared trust domain, no east-west gateway), this repo's Istio
installs would need three separate manually-exchanged trust bundles for any of this to work at all
— compounding the key-custody problem above rather than solving it.

### Istio's actual first-party SPIRE integration runs the other direction

Istio does have a dedicated, current doc for a SPIRE integration — but it replaces Istio's own CA
with SPIRE as the *source* of Istio's workload certificates, not a way to make Istio's identities
independently consumable:

> "SPIRE can be configured as a source of cryptographic identities for Istio workloads through an
> integration with [Envoy's SDS
> API](https://www.envoyproxy.io/docs/envoy/latest/configuration/security/secret). Istio can detect
> the existence of a UNIX Domain Socket that implements the Envoy SDS API on a defined socket path,
> allowing Envoy to communicate and fetch identities directly from it."

— [Istio Ops Integrations: SPIRE](https://istio.io/latest/docs/ops/integrations/spire/). The same
doc requires an exact SPIFFE ID format match — `spiffe://<trust.domain>/ns/<namespace>/sa/<service-account>`
— and warns that SPIRE and Istio "are configured with the exact same trust domain, to prevent
authentication and authorization errors." This doc is written entirely in terms of Istio's
**sidecar** Envoy proxies fetching certs via SDS; it does not describe an ambient/ztunnel-specific
integration path, and this research found none documented. In other words: the one first-party
SPIRE↔Istio integration that exists points SPIRE *into* Istio (replacing Istio's CA), which is the
inverse of #54's actual question (can something *outside* Istio consume Istio's own identities).

### Bottom line for Question 2

Based on Istio's own docs, there is no supported mechanism today for OpenBao or AWS to directly
validate an Istio-ambient-issued SPIFFE identity as a relying party. The blocking factors are
structural (ztunnel holds the key material, not the app; no JWT-SVID equivalent is issued; no
bundle-endpoint hosting), not merely undocumented, and are compounded — not solved — by ADR 0009's
independent-per-cluster-root-CA decision.

---

## Question 3: OpenBao's own supported auth methods

### The complete, current list — confirmed against OpenBao, not inherited from Vault

OpenBao is explicit on its own homepage about being a fork, which is exactly why this needed
independent verification: **"OpenBao is an open source, community-driven secrets manager and fork of
Vault managed by the Linux Foundation's OpenSSF"** — [openbao.org](https://openbao.org/). Its own
docs' Auth Methods navigation, confirmed identically across multiple pages
([Auth methods overview](https://openbao.org/docs/auth/),
[Kubernetes auth method](https://openbao.org/docs/auth/kubernetes/)), lists exactly:
**AppRole, TLS Certificates (`cert`), JWT/OIDC (`jwt`), Kerberos, Kubernetes, LDAP, Login MFA,
RADIUS, Token, Userpass**. No `aws`, `azure`, `gcp`, `github`, `okta`, `saml`, `alicloud`, or `oci`
auth method appears anywhere in that navigation — a real, sourced divergence from upstream
HashiCorp Vault, which has shipped first-party cloud-provider auth methods for years. Neither
`spiffe` nor `SPIFFE` appears anywhere in OpenBao's `jwt` or `cert` auth-method docs — **OpenBao has
no SPIFFE-specific integration today.**

### Kubernetes auth — the pattern #49 already assumes

OpenBao's Kubernetes auth method validates a Kubernetes service-account token against one specific
cluster's TokenReview API, configured per mount:

> "Use the `/config` endpoint to configure OpenBao to talk to Kubernetes... `bao write
> auth/kubernetes/config token_reviewer_jwt=... kubernetes_host=https://... kubernetes_ca_cert=@ca.crt`"

— [OpenBao Kubernetes auth method](https://openbao.org/docs/auth/kubernetes/). Because
`kubernetes_host`/`token_reviewer_jwt` bind one auth mount to one specific cluster's API server,
this method is inherently per-cluster: authorizing a second workload cluster's service accounts
means configuring OpenBao (on the platform cluster) to trust a *second* cluster's API server as an
additional TokenReview target — either a second mount path, or granting the existing mount visibility
into a second cluster's API, neither of which OpenBao's own docs describe as a built-in
"multi-cluster" mode. This confirms #49's framing directly: the Kubernetes auth method is a
genuinely per-cluster federation, not a unifying mechanism across clusters on its own.

### JWT/OIDC — the generic option, structurally capable of validating a K8s issuer or a SPIFFE JWT-SVID

OpenBao's `jwt` auth method supports two modes: interactive OIDC login, and direct JWT presentation
validated either against locally-configured keys or a fetched OIDC discovery document:

> "The `jwt` auth method can be used to authenticate with OpenBao using OIDC or by providing a JWT.
> ... a JWT can be provided directly. The JWT is cryptographically verified using locally-provided
> keys, or, if configured, **an OIDC Discovery service can be used to fetch the appropriate keys**."

— [OpenBao JWT/OIDC auth method](https://openbao.org/docs/auth/jwt/), configured via
`oidc_discovery_url` on `auth/jwt/config`. Nothing in this mechanism is SPIFFE-branded, but nothing
about it is SPIFFE-*incompatible* either: `oidc_discovery_url` accepts any OIDC-compliant issuer,
which would include a Kubernetes cluster's own `service-account-issuer` (if made externally
reachable) or SPIRE's own OIDC Discovery Provider (see Question 1/6) serving JWT-SVIDs. Roles support
arbitrary `bound_claims` matching and `bound_subject`/`bound_audiences`, giving fine-grained control
over which issued tokens are accepted — [OpenBao JWT/OIDC auth
method](https://openbao.org/docs/auth/jwt/).

### TLS certificates — structurally capable of validating an X.509-SVID's URI SAN

The `cert` auth method authenticates TLS client certificates against configured trusted CAs or exact
certs, with role-level constraints including a URI SAN glob match:

> "`allowed_uri_sans` (`string: "" or array: []`) - Constrain the Alternative Names in the client
> certificate with a globbed pattern... Authentication requires at least one URI matching at least
> one pattern."

— [OpenBao Auth Methods API: TLS Certificates](https://openbao.org/docs/api/auth/cert/). A SPIFFE
X.509-SVID's identity *is* its certificate's URI SAN (`spiffe://trust-domain/ns/.../sa/...`), so
`allowed_uri_sans` set to a glob like `spiffe://example.org/ns/*/sa/*` would, mechanically, validate
one. This is again unbranded — no mention of SPIFFE anywhere in this doc — but structurally
sufficient. The practical blocker, per Question 2's findings, is not OpenBao's capability here but
the fact that Istio ambient never hands the workload process its own SVID private key to present in
a direct TLS handshake with OpenBao in the first place; this mechanism would be directly usable
against a **SPIRE**-issued X.509-SVID (which a workload *does* hold directly), not against an
Istio-ambient-issued one.

### No SPIFFE-specific integration, but a generic plugin architecture

OpenBao's plugin system is explicitly generic and pluggable — "External plugins are not shipped with
OpenBao and require additional operator steps to be installed... completely separate, standalone
applications that OpenBao executes and communicates with over gRPC" —
[OpenBao Plugins](https://openbao.org/docs/plugins/). This means a purpose-built SPIFFE-aware auth
plugin is architecturally possible, but this research found no such plugin shipped by or documented
by either OpenBao or the SPIFFE/SPIRE project.

---

## Question 4: Self-hosted IRSA re-examined for Talos/Omni

### Bare Talos: fully supported, first-party, same mechanism as this repo's k3s recipe

Talos Linux has its own dedicated guide for this exact pattern, using the same conceptual model as
`irsa.md`'s k3s recipe (custom signing keypair, custom `service-account-issuer`, publicly-hosted
OIDC discovery documents, `amazon-eks-pod-identity-webhook`), expressed as Talos machine-config
fields:

> "Patch your Talos `machineconfig` to use the new Service Account issuer and signing key... `cluster:
> apiServer: extraArgs: service-account-issuer: ${ISSUER_HOSTPATH} serviceAccount: key:
> ${BASE64_ENCODED_PRIVATE_KEY}`"

— [Talos docs: IRSA with Talos
Linux](https://docs.siderolabs.com/talos/v1.13/security/iam-roles-for-service-accounts.md), which
explicitly credits "the official instructions for setting up the [Amazon EKS Pod Identity Webhook in
a self-hosted environment](https://github.com/aws/amazon-eks-pod-identity-webhook/blob/master/SELF_HOSTED_SETUP.md)"
— the same upstream project this repo's own `irsa.md` is built on. On bare Talos (no Omni), this
extends cleanly.

### Omni specifically: the signing-key field is reserved, confirmed by Omni's own docs

This repo's clusters are not bare Talos — they are Omni-managed (#7), and Omni imposes its own
restrictions on machine configuration beyond Talos's own defaults. Omni's conceptual "How
configuration works in Omni" doc gives the authoritative, most detailed breakdown found in this
research, dividing every Talos config field into three categories: "Reserved by Omni," "Managed
through dedicated Omni resources," and "Configured through patches." The signing-key field IRSA
needs falls in the first, blocked category:

> "These fields are managed by Omni and cannot be set by a user patch. Patch attempts against them
> are either rejected with a `MergeDenied` error or silently stripped during reconciliation. Reserved
> fields include: ... Cluster-level CAs and signing certs: `cluster.ca`, `cluster.aggregatorCA`,
> **`cluster.serviceAccount`** ... Specific derived fields like
> `cluster.controllerManager.extraArgs.service-account-key-file`"

— [Omni docs: How configuration works in
Omni](https://docs.siderolabs.com/omni/omni-cluster-setup/how-configuration-works-in-omni.md). The
same doc separately notes that `cluster.apiServer.extraArgs.*` generally *is* patchable — "Some keys
(e.g., `audit-log-*`) are accepted by the patch validator but silently dropped by Talos" (implying
most other `apiServer.extraArgs` keys, including `service-account-issuer`, are not on that
known-dropped list) — meaning a user could plausibly set a custom **issuer URL**, but not the
**signing key** that URL's JWKS would need to correspond to. Without control of the actual signing
key, there is no documented way to derive and publish the correct JWKS at a custom issuer endpoint,
because Omni generates and rotates that keypair internally.

**A caveat about source consistency, flagged rather than silently resolved**: Omni's separate,
older-styled ["Talos Config
Overrides"](https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md) reference
page — the one already consulted in this repo's sibling load-balancer research — lists
`cluster.controlPlane.endpoint`, `cluster.secret`, `cluster.ca`/`cluster.etcdCA`/`cluster.kubernetesCA`,
`cluster.vip`, and several `machine.*` fields as forbidden/ignored, but its list **does not mention
`cluster.serviceAccount` or `cluster.aggregatorCA` at all**. The two Omni docs pages disagree on
completeness. This research treats the newer, more granular "How configuration works in Omni" page
(which explicitly frames itself as a complete three-way partition of the entire config schema) as the
more authoritative and current source for this specific field, but the discrepancy between Omni's own
docs pages is itself worth carrying forward rather than silently resolving — it was not possible to
find a single canonical, exhaustive list confirmed in exactly one place.

### The public-reachability problem compounds this, independent of Omni's reservation

Even setting the signing-key reservation aside, IRSA's OIDC discovery documents must be reachable
over the public internet for AWS STS to fetch them — this repo's own `irsa.md` publishes them to a
public S3 bucket for exactly this reason, and AWS's own docs confirm the requirement generally (see
Question 6). ADR 0011 already establishes that every Omni-managed cluster is reachable externally
**only** through Omni's own WireGuard-tunneled proxy, and separately notes that Omni-native
workload/OIDC federation for machine clients is an **open, unimplemented Omni feature request**
([siderolabs/omni#2663](https://github.com/siderolabs/omni/issues/2663), cited directly in ADR
0011). So even if the signing-key reservation were worked around, a self-hosted-IRSA-style approach
on this repo's actual stack would still need a wholly separate, Omni-independent public HTTPS
endpoint to publish JWKS from — the same requirement this repo's *existing* k3s IRSA setup already
satisfies via its own S3 bucket, unrelated to Omni's proxy.

### Per-cluster bootstrap burden vs. a unified identity

IRSA's issuer identity is inherently cluster-local by construction: one signing keypair, one issuer
URL, one AWS IAM OIDC Identity Provider registration, per cluster
([irsa.md](https://github.com/aaronkyriesenbach/catalyst/blob/master/irsa.md); confirmed identical
in shape by [Talos's own IRSA
doc](https://docs.siderolabs.com/talos/v1.13/security/iam-roles-for-service-accounts.md)). Three
clusters would mean three independent one-time bootstraps and three separate AWS IAM OIDC providers
— exactly the "N separate per-cluster federations" #55 frames as the thing worth avoiding if a
better option exists. Of the options surveyed in this document, only a single-trust-domain SPIRE
deployment spanning all three clusters (Question 1/5) can present *one* issuer/JWKS/AWS IAM OIDC
provider to external consumers instead of three; Istio-ambient-reuse cannot do this at all (Question
2), both for the structural key-custody reasons found there and because ADR 0009 already commits
each cluster to an independent root CA even if the key-custody problem were solved.

---

## Question 5: Production/enterprise patterns for multi-cluster, non-hyperscaler-managed identity

### SPIFFE/SPIRE is CNCF-graduated and has real production case studies — but at a different scale

SPIFFE holds **Graduated** status in the CNCF's own project directory —
[cncf.io/projects/spiffe](https://www.cncf.io/projects/spiffe/) — the foundation's highest maturity
tier, requiring (per CNCF's general graduation criteria) production usage by multiple organizations
and a demonstrated, sustained contributor base. SPIRE's own case-studies page — curated conference
presentations, not third-party blog commentary — documents production or near-production use at
GitHub, Uber (twice, including a dedicated "Using SPIRE in Production at Uber" KubeCon talk), Square
(now Block, across "a bare metal/multicloud hybrid environment"), ByteDance/TikTok ("Designing
Scalable, PKI-based Authentication With SPIRE"), Pinterest, TransferWise (cross-regulatory-boundary
trust), and Anthem/doc.ai (healthcare zero-trust) —
[SPIRE Case Studies](https://spiffe.io/docs/latest/spire-about/case-studies/). This is real,
citable, primary-source-adjacent evidence (each talk is a first-party account from an engineer at
the named company, hosted on SPIFFE's own site) that SPIRE is a mainstream answer at a certain scale.

**The honest caveat**: every one of these organizations operates at a scale — multiple data centers
or cloud providers, thousands of workloads and nodes, and (based on the talks' own framing) a
dedicated platform-security team building and operating the SPIRE deployment as a specialized
function — that is qualitatively different from a single-operator, three-cluster homelab. This
research did not find a single primary-source case study, from SPIFFE's own materials or elsewhere
searched, describing SPIRE deployed and operated by one person across a small, self-hosted cluster
fleet. The proportionality question #54 poses (mainstream at scale, or overkill here) is not
resolved by the case-study material either way — it demonstrates SPIRE works and is trusted at scale,
not that its operational footprint is worthwhile below that scale.

### Per-cluster OIDC federation is the default *because* hyperscalers run the issuer side for you

The AWS/GCP/Azure docs surveyed in Question 6 all describe workload identity federation as a
managed-Kubernetes-native feature: IRSA, GKE's "Workload Identity Federation for GKE," and Azure's
"Microsoft Entra Workload ID" are each built assuming the hyperscaler's own managed control plane
already exposes (or can easily be configured to expose) a durable, public OIDC issuer per cluster.
None of the primary sources surveyed here directly addresses the specific case this repo has: several
independent, **self-hosted**, on-prem clusters, needing to present identity to both an external cloud
API (AWS) and an internal secrets store (OpenBao), with no managed-Kubernetes provider doing the
issuer-hosting work. This is a genuine gap in the primary-source material available, honestly
reported rather than papered over: this research had to reason from the mechanism-level docs
(SPIFFE/SPIRE's own architecture and topology docs, Istio's own docs, OpenBao's own docs) rather than
from a vendor or CNCF architecture document describing this exact scenario end-to-end. The closest
primary-source analogue found is SPIRE's own "Federation with OIDC-Provider Systems" documentation
(Question 6), which describes the generic mechanism (a SPIRE-hosted OIDC Discovery Provider
federating to AWS) without being scoped to any particular deployment scale.

---

## Question 6: Cloud-native prior art (GCP Workload Identity Federation, Azure Workload Identity)

### AWS IRSA (recap, for direct comparison)

AWS's own EKS docs describe the mechanism this repo's `irsa.md` already documents in detail:

> "Amazon EKS hosts **a public OIDC discovery endpoint for each cluster** that contains the signing
> keys for the `ProjectedServiceAccountToken` JSON web tokens so external systems, such as IAM, can
> validate and accept the OIDC tokens that are issued by Kubernetes."

— [AWS EKS docs: IAM roles for service
accounts](https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html).
Public reachability of the issuer's discovery document is a hard requirement of this design, not an
implementation detail — the same doc's troubleshooting note about `NXDOMAIN` errors for
private-VPC-only issuer hosts underlines this.

### GCP Workload Identity Federation — the outlier that doesn't need public reachability

GCP's own IAM docs describe Workload Identity Federation as deliberately general — supporting X.509
client certs, AWS/Azure, on-prem Active Directory, CI/CD systems (GitHub/GitLab), and any generic
OIDC/SAML IdP — and, notably, offer a path with no public-endpoint requirement at all:

> "To federate workloads that don't have a public OIDC endpoint, you can upload OIDC JSON Web Key
> Sets (JWKS) directly to the pool. This is common if you have Terraform or GitHub Enterprise hosted
> in your own environment or **you have regulatory requirements not to expose public URLs**."

— [GCP IAM docs: Workload Identity
Federation](https://cloud.google.com/iam/docs/workload-identity-federation). This is a genuine
structural difference from both AWS IRSA and Azure Workload Identity (below): GCP explicitly designed
for self-hosted issuers that are never exposed to the public internet, which is exactly this repo's
situation (every cluster sits behind Omni's WireGuard proxy, per ADR 0011). This repo is AWS-only
per #54's own framing, so this is prior art/context rather than an actionable option — but it demonstrates
the "must be publicly reachable" constraint found for AWS/Azure/SPIRE's own OIDC-federation tutorial
is not an inherent property of OIDC federation in general, only of how AWS, Azure, and SPIRE's own
AWS tutorial each chose to implement it.

GKE's own cluster-level feature, **"Workload Identity Federation for GKE,"** is the GKE-native
consumer of this same mechanism for GKE-hosted clusters specifically —
[GKE docs: Authenticate to Google Cloud APIs from GKE
workloads](https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity) — not directly
applicable to a self-hosted Talos cluster, but confirms GCP treats this as first-class, built-in
functionality the same way AWS and Azure do for their own managed offerings.

### Azure Workload Identity — the same public-endpoint requirement as AWS

Azure's own AKS docs describe an identical mechanism and requirement to AWS IRSA:

> "In this security model, the AKS cluster acts as the token issuer. Microsoft Entra ID uses OIDC to
> discover public signing keys and verify the authenticity of the service account token before
> exchanging it for a Microsoft Entra token... `{IssuerURL}/openid/v1/jwks` — This contains the
> public signing key(s) that Microsoft Entra ID uses to verify the authenticity of the service
> account token."

— [Microsoft Learn: Use Microsoft Entra Workload ID with Azure Kubernetes Service
(AKS)](https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview). Microsoft's more
general (non-AKS-specific) "workload identity federation" mechanism — usable by any external IdP, not
just AKS — describes the same public-fetch requirement even more explicitly: "Microsoft identity
platform... validates the external token against the OpenID Connect (OIDC) issuer URL on the external
IdP" and "stores only the first 100 signing keys when they're downloaded **from the external IdP's
OIDC endpoint**" — [Microsoft Learn: Workload identity federation
concepts](https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation). No local
JWKS upload option analogous to GCP's was found documented for Azure.

### Summary: is AWS IRSA a narrow special case, or the industry norm?

Both AWS and Azure require a publicly-fetchable OIDC issuer; only GCP explicitly designed around not
needing one. So IRSA is not AWS-idiosyncratic in mechanism — it's the same core OAuth 2.0
token-exchange pattern
([RFC 8693](https://tools.ietf.org/html/rfc8693), cited directly by GCP's own docs) all three
hyperscalers implement, generally requiring a durably-hosted, publicly-reachable issuer. GCP's local-JWKS
option is the exception, not the rule, among the three surveyed — but it is the one option among all
of AWS/Azure/GCP's own native mechanisms that would not need a workaround for this repo's
Omni-WireGuard-only external reachability, were this repo ever multi-cloud. SPIRE's own AWS
federation path (Question 1/5) inherits AWS's own public-endpoint requirement and does not have a
"local JWKS" equivalent for AWS specifically — its unification benefit is reducing three cluster-local
issuers to one, not removing the public-reachability requirement itself.

---

## Recommendation

None — by design. This ticket's own instructions, and the wayfinder map's split between research and
grilling tickets, place the actual mechanism decision in
[#55](https://github.com/aaronkyriesenbach/catalyst/issues/55). What this research contributes to
that session:

- SPIFFE/SPIRE has a concrete, sourced Talos-compatible node-attestation path (`k8s_psat`) and can
  present one unified identity across all three clusters, but is a second control plane with real,
  sourced operational cost (2-server HA floor, a shared SQL datastore, a Talos-PSA-friction
  namespace) layered on top of, not replacing, anything already adopted.
- Istio ambient's existing SPIFFE identities cannot be directly consumed by OpenBao or AWS today,
  confirmed structurally (ztunnel holds the keys, not the app) and by Istio's own docs on trust-bundle
  federation ("Istio does not provide any tooling") and its own SPIRE integration (runs SPIRE→Istio,
  not Istio→external).
- OpenBao's real, current auth-method list is narrower than upstream Vault's and has zero
  SPIFFE-specific integration, but its generic `jwt` and `cert` methods are structurally capable of
  consuming a SPIFFE-format credential if one is available.
- This repo's existing self-hosted-IRSA pattern is fully Talos-compatible but not Omni-compatible as
  documented — Omni reserves the exact signing-key field IRSA needs — and independently needs a
  public HTTPS endpoint outside Omni's WireGuard-only reachability model regardless.
- GCP's Workload Identity Federation is the one hyperscaler mechanism surveyed that doesn't require
  public issuer reachability at all — relevant context, not an actionable option, given this repo is
  AWS-only.
- Production-scale SPIFFE/SPIRE adoption is real and CNCF-graduated, but every citable case study
  found is at a scale with a dedicated team — this research found no primary-source precedent at
  single-operator homelab scale in either direction.

---

## Sources

**SPIFFE / SPIRE**

- SPIRE Concepts (architecture, attestation, "day in the life of an SVID") — <https://spiffe.io/docs/latest/spire-about/spire-concepts/>
- About SPIRE — <https://spiffe.io/docs/latest/spire-about/>
- SPIRE Use Cases (Workload API, direct credential retrieval) — <https://spiffe.io/docs/latest/spire-about/use-cases/>
- SPIRE Case Studies — <https://spiffe.io/docs/latest/spire-about/case-studies/>
- Scaling SPIRE (topologies, HA, sizing table, OIDC federation) — <https://spiffe.io/docs/latest/planning/scaling_spire/>
- SPIRE Server Configuration Reference (node attestor/upstream authority plugin lists) — <https://spiffe.io/docs/latest/deploying/spire_server/>
- SPIRE server plugin: NodeAttestor "k8s_psat" — <https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_server_nodeattestor_k8s_psat.md>
- SPIRE agent plugin: NodeAttestor "k8s_psat" — <https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_agent_nodeattestor_k8s_psat.md>
- SPIRE server plugin: NodeAttestor "jointoken" — <https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_server_nodeattestor_jointoken.md>
- SPIRE server plugin: NodeAttestor "tpm_devid" — <https://github.com/spiffe/spire/blob/v1.15.2/doc/plugin_server_nodeattestor_tpm_devid.md>
- SPIRE server plugin: UpstreamAuthority "vault" — referenced in SPIRE Server Configuration Reference (above)
- AWS OIDC Authentication tutorial (SPIRE OIDC Discovery Provider federating to AWS) — <https://spiffe.io/docs/latest/keyless/oidc-federation-aws/>
- SPIRE Helm Charts Hardened: Recommendations (namespace layout, Pod Security Standards) — <https://spiffe.io/docs/latest/spire-helm-charts-hardened-about/recommendations/>
- SPIRE Helm Charts Hardened: Installation (production deployment) — <https://spiffe.io/docs/latest/spire-helm-charts-hardened-about/installation/>
- CNCF SPIFFE project page (Graduated status) — <https://www.cncf.io/projects/spiffe/>

**Istio**

- Ambient and the Istio control plane (ztunnel cert custody) — <https://istio.io/latest/docs/ambient/architecture/control-plane/>
- Use Layer 4 security policy (AuthorizationPolicy, source.principal, ztunnel enforcement) — <https://istio.io/latest/docs/ambient/usage/l4-policy/>
- Deployment Models (trust between meshes, SPIFFE Trust Domain Federation, mesh models) — <https://istio.io/latest/docs/ops/deployment/deployment-models/>
- `istio.mesh.v1alpha1` configuration reference (trustDomain, spiffeBundleUrl, ForwardClientCertDetails/XFCC) — <https://istio.io/latest/docs/reference/config/istio.mesh.v1alpha1/>
- Istio Ops Integrations: SPIRE (SDS-based SPIRE→Istio CA integration, SPIFFE federation) — <https://istio.io/latest/docs/ops/integrations/spire/>
- Concepts: Security (Istio identity model, X.509 identity/certificate management) — <https://istio.io/latest/docs/concepts/security/>

**OpenBao**

- What is OpenBao? (fork of Vault, LF/OpenSSF) — <https://openbao.org/docs/what-is-openbao/> and <https://openbao.org/>
- Auth methods overview — <https://openbao.org/docs/auth/>
- Kubernetes auth method — <https://openbao.org/docs/auth/kubernetes/>
- Kubernetes auth method API reference — <https://openbao.org/docs/api/auth/kubernetes/>
- JWT/OIDC auth method — <https://openbao.org/docs/auth/jwt/>
- JWT/OIDC auth method API reference — <https://openbao.org/docs/api/auth/jwt/>
- TLS Certificates auth method — <https://openbao.org/docs/auth/cert/>
- TLS Certificates auth method API reference (`allowed_uri_sans`) — <https://openbao.org/docs/api/auth/cert/>
- Plugins overview (external plugin architecture) — <https://openbao.org/docs/plugins/>

**Talos / Omni**

- IRSA with Talos Linux — <https://docs.siderolabs.com/talos/v1.13/security/iam-roles-for-service-accounts.md>
- Omni docs: How configuration works in Omni (reserved/dedicated-resource/patchable field partition) — <https://docs.siderolabs.com/omni/omni-cluster-setup/how-configuration-works-in-omni.md>
- Omni docs: Talos Config Overrides — <https://docs.siderolabs.com/omni/cluster-management/talos-config-overrides.md>
- Omni docs: Create a Patch for Cluster Machines — <https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-patch-for-cluster-machines.md>
- Omni docs: Cluster Templates reference — <https://docs.siderolabs.com/omni/reference/cluster-templates.md>
- Talos/Omni docs index (`llms.txt`) — <https://docs.siderolabs.com/llms.txt>

**AWS / GCP / Azure**

- AWS EKS docs: IAM roles for service accounts (public OIDC discovery endpoint requirement) — <https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html>
- GCP IAM docs: Workload Identity Federation (local JWKS upload option, OAuth 2.0 token exchange/RFC 8693) — <https://cloud.google.com/iam/docs/workload-identity-federation>
- GKE docs: Authenticate to Google Cloud APIs from GKE workloads — <https://cloud.google.com/kubernetes-engine/docs/how-to/workload-identity>
- Microsoft Learn: Use Microsoft Entra Workload ID with AKS — <https://learn.microsoft.com/en-us/azure/aks/workload-identity-overview>
- Microsoft Learn: Workload identity federation concepts — <https://learn.microsoft.com/en-us/entra/workload-id/workload-identity-federation>

**catalyst repo (current-state context)**

- `irsa.md` (existing self-hosted IRSA pattern for k3s)
- `docs/adr/0004-secrets-management-openbao.md` (OpenBao decision)
- `docs/adr/0009-ingress-istio-no-mesh-span.md` (Istio ambient, independent per-cluster root CAs)
- `docs/adr/0011-cluster-registration-cross-cluster-auth.md` (Omni WireGuard-only reachability; Omni machine-identity-federation feature request cited there: [siderolabs/omni#2663](https://github.com/siderolabs/omni/issues/2663))
- `docs/adr/0013-oidc-forward-auth-istio-authservice-waypoint.md` (Istio's human-OIDC forward-auth pattern, contrasted with machine identity here)
- `docs/research/loadbalancer-talos-research.md` (sibling research; Talos PSA/`kube-system` exemption precedent referenced above)
- catalyst repo issues consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1) (wayfinder map), [#7](https://github.com/aaronkyriesenbach/catalyst/issues/7) (Talos + self-hosted Omni resolution), [#11](https://github.com/aaronkyriesenbach/catalyst/issues/11) (secrets-management resolution), [#21](https://github.com/aaronkyriesenbach/catalyst/issues/21) (service mesh resolution), [#36](https://github.com/aaronkyriesenbach/catalyst/issues/36) (ingress/mesh-span resolution), [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47) (traffic-routing ticket that surfaced this question), [#49](https://github.com/aaronkyriesenbach/catalyst/issues/49) (cross-cluster OpenBao/ESO reachability), [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55) (follow-on grilling ticket this research feeds)
