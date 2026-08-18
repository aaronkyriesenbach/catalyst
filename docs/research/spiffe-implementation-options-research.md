# Research: SPIFFE-compatible workload-identity implementation options (Teleport and others), and Postgres/CloudNativePG client-cert-auth compatibility

**Ticket**: [#59](https://github.com/aaronkyriesenbach/catalyst/issues/59) — feeds [Decide the specific
SPIFFE-compatible implementation for the platform's machine-identity control plane
(#58)](https://github.com/aaronkyriesenbach/catalyst/issues/58), which itself resolves [Decide
machine-identity mechanism for workload identity across the multi-cluster platform
(#55)](https://github.com/aaronkyriesenbach/catalyst/issues/55)'s open follow-on — part of the ["Homelab
platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: #55 already settled the mechanism *family* — a dedicated SPIFFE-based workload-identity control
plane, not an identity-broker platform (ruled out by
[#56](https://github.com/aaronkyriesenbach/catalyst/blob/research/identity-broker-machine-identity-research/docs/research/identity-broker-machine-identity-research.md))
and not this repo's existing IRSA pattern or AWS IAM Roles Anywhere (not cloud-agnostic) — driven by genuine
cross-cluster workload-to-workload identity and cloud-agnosticism requirements a hub-and-spoke broker
structurally can't meet. This document does not re-litigate that family choice. It fills the remaining
research gap #58 needs to pick a specific implementation: (1) Teleport Workload Identity, surveyed against
the same shape of questions [#54's
research](https://github.com/aaronkyriesenbach/catalyst/blob/research/machine-identity-research/docs/research/machine-identity-research.md)
already asked of SPIRE; (2) an active search for any other credible, self-hostable, SPIFFE-compatible
workload-identity control plane not yet named anywhere on this map; and (3) whether a SPIFFE-based
mechanism could additionally let an app authenticate to its CloudNativePG-hosted Postgres database (ADR
0010) with its own X.509-SVID instead of today's static password Secret. Per this ticket's own instructions,
**this document does not decide anything** — the decision is deferred to #58.

---

## TL;DR

- **Teleport Workload Identity is a genuine, separately-documented SPIFFE implementation, but "just the
  Workload Identity feature" still means standing up Teleport's full control plane — an Auth Service and a
  Proxy Service — confirmed directly by Teleport's own architecture and deployment docs, even though that
  control plane's bastion/PAM/session-recording features go entirely unused.** Every Workload Identity guide
  this research checked lists the identical prerequisite: **"A running Teleport cluster accessible at a
  hostname with a valid TLS certificate."** — [Getting Started with Workload
  Identity](https://goteleport.com/docs/machine-workload-identity/workload-identity/getting-started/).
  Teleport's own architecture doc defines that cluster as **"the Teleport Auth Service and Teleport Proxy
  Service"** — [Teleport
  Architecture](https://goteleport.com/docs/reference/architecture/). The core Workload Identity issuance
  capability itself is in the free, self-hosted, AGPL-3.0-licensed Community Edition (confirmed via GitHub's
  own license metadata and Teleport's own feature matrix), and its default storage backend is a **single
  local directory (SQLite)** on one Auth Service instance — no 2-instance HA floor is documented as a
  starting requirement the way SPIRE's own scaling docs describe (per #54's already-established finding) —
  [Storage Backends](https://goteleport.com/docs/reference/deployment/backends/). But cross-trust-domain
  **SPIFFE Federation is gated behind Teleport Enterprise** — *"A valid Teleport Enterprise license is
  required to use the federation features of Teleport Workload Identity"* — [SPIFFE
  Federation](https://goteleport.com/docs/machine-workload-identity/workload-identity/federation/) — though
  this repo's actual need (one trust domain spanning three clusters, not bridging to an external
  organization's trust domain) does not require that feature at all.
- **Teleport's own attestation mechanics split into exactly the same three-way structure #57's research
  already found for SPIRE — a live-TokenReview variant blocked by this repo's Omni/Talos topology, a
  static-signature variant that sidesteps it, and a public-discovery variant blocked the same way AWS IRSA
  is — confirmed directly against Teleport's own join-methods reference, independently of and not previously
  surfaced by #54's or #57's SPIRE-only research.** The **Kubernetes in-cluster** join method "relies on the
  Kubernetes **TokenReview API** which is typically only reachable from within the Kubernetes cluster...
  this join method is only available for self-hosted Teleport clusters in Kubernetes" — [Join
  Methods](https://goteleport.com/docs/reference/deployment/join-methods/) — the same ongoing,
  cross-cluster-credential shape #57 found for SPIRE's `k8s_psat`, and equally unusable for a
  platform-cluster-hosted Auth Service attesting workload-cluster tbot agents. The **Kubernetes JWKS**
  (`static_jwks`) variant is structurally different from anything SPIRE offers for this case: *"This join
  method works by exporting the public Kubernetes signing keys and using them to validate Kubernetes SA
  token signatures. **The signature validation can be performed by an Auth Service without access to the
  Kubernetes** [cluster]"* — same source — a one-time pasted JWKS blob, verified entirely offline, with
  **no live outbound call to the workload cluster's API server at attestation time at all**, at the cost of
  a manual re-paste whenever the signing key rotates (*"After rotating the Kubernetes CA, you must update
  the Kubernetes JWKS tokens to contain the new Kubernetes signing keys"* — same source). The **Kubernetes
  OIDC** variant, by contrast, needs the workload cluster's own OIDC discovery endpoint to be **publicly
  reachable** — its own setup guide's verification step insists this be tested "over the public internet" —
  [Kubernetes
  OIDC](https://goteleport.com/docs/machine-workload-identity/deployment/kubernetes-oidc/) — running
  straight into the exact gap #57 already found (Omni's discovery/JWKS endpoints resolve to internal-only
  addresses today, unless [siderolabs/omni#2266](https://github.com/siderolabs/omni/issues/2266) ships).
- **Teleport's own AWS OIDC federation issues a discovery endpoint the same architectural way SPIRE's OIDC
  Discovery Provider does, but hosted by the Teleport Proxy Service itself rather than a separate component**
  — configuring AWS's own OIDC Identity Provider means specifying, as the issuer, *"the public address of
  your Teleport Proxy Service with the path `/workload-identity` appended... Your Teleport Proxy Service
  must be accessible by AWS in order for OIDC federation to work"* — [AWS OIDC
  Federation](https://goteleport.com/docs/machine-workload-identity/workload-identity/aws-oidc-federation/).
  Because this is Teleport's own application-layer identity (not the workload cluster's own Kubernetes API
  server issuer), exposing it publicly is an ordinary app-exposure problem this repo already has a proven
  answer for (Cloudflare Tunnel, per
  [#56](https://github.com/aaronkyriesenbach/catalyst/blob/research/identity-broker-machine-identity-research/docs/research/identity-broker-machine-identity-research.md)'s
  Question 3 finding) — not blocked by ADR 0011's Omni-WireGuard-only Kubernetes-API-server restriction the
  way a workload cluster's own discovery endpoint is. No Teleport-specific OpenBao or HashiCorp Vault
  integration was found documented anywhere by this research; Teleport's JWT-SVID is an ordinary
  OIDC-compliant token with a standard discovery/JWKS endpoint, so OpenBao's already-established generic
  `jwt` auth method (`oidc_discovery_url`, per #54's research) would consume it identically to any other
  OIDC issuer — this is reasoned from #54's already-confirmed OpenBao facts plus Teleport's own docs, not
  itself a Teleport-documented integration.
- **An active search beyond this map's prior research surfaced exactly one credible, distinct,
  self-hostable SPIFFE-*ID*-compatible control plane — Athenz — but it is a materially weaker fit than
  either SPIRE or Teleport on SPIFFE conformance and CNCF maturity, confirmed directly by Athenz's own
  head-to-head comparison page.** Athenz "supports issuing X.509 Certificates to registered services with
  SPIFFE IDs as URIs, **however it does not implement the Workload API**s. Athenz provides its own REST API
  that agents use to retrieve certificates" and "only issues X.509 Certificates" (no JWT-SVID) — [Athenz vs.
  SPIRE Comparison](https://www.athenz.io/comparison.html). Athenz is a CNCF **Sandbox**-level project (the
  entry rung, below SPIFFE/SPIRE's own **Graduated** status) — *"Athenz was accepted to CNCF on January 26,
  2021 at the Sandbox maturity level"* — [CNCF: Athenz](https://www.cncf.io/projects/athenz/) — and its own
  comparison page candidly describes its user community as "Small" against SPIRE's "Big." Several other
  SPIFFE-adjacent projects surfaced during this search (Red Hat's Zero Trust Workload Identity Manager,
  Cofide's `cofidectl`, HPE's Galadriel) were checked and found to be **repackagings or orchestration layers
  around upstream SPIRE itself**, not distinct implementations, and are not credible new candidates for this
  reason.
- **PostgreSQL's native `cert` authentication method does not read a certificate's URI SAN at all — only
  the Common Name or full Distinguished Name of the Subject field — confirmed directly and unambiguously
  against PostgreSQL's own current documentation, with no version offering a SAN-aware alternative.**
  *"The `cn` (Common Name) attribute of the certificate will be compared to the requested database user
  name... User name mapping can be used to allow `cn` to be different from the database user name."* —
  [PostgreSQL docs: Certificate
  Authentication](https://www.postgresql.org/docs/current/auth-cert.html). The `pg_hba.conf` reference is
  equally explicit that only two matching modes exist at all: *"If you specify `clientname=CN`, which is
  the default, the username is matched against the certificate's Common Name (CN). If instead you specify
  `clientname=DN` the username is matched against the entire Distinguished Name (DN) of the certificate."*
  — [PostgreSQL docs: The `pg_hba.conf`
  File](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html). Neither option, nor any other
  documented anywhere in current PostgreSQL, reads a URI SAN — where a SPIFFE ID actually lives.
- **A workaround exists and is spec-legal, not a hack: the SPIFFE X.509-SVID specification itself permits
  (though doesn't require) an additional DNS SAN alongside the mandatory URI SAN, and both SPIRE's and
  Teleport's own registration/issuance models expose a lever for it — but a bare, spec-minimal SPIFFE
  X.509-SVID (URI SAN only, empty Subject) will not satisfy Postgres's `cert` auth out of the box.** The
  SPIFFE spec: *"An X.509 SVID MUST contain exactly one URI SAN... An X.509 SVID **MAY** contain any number
  of other SAN field types, including DNS SANs"* and *"The Subject field is **not required**"* —
  [SPIFFE X.509-SVID
  specification](https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md). SPIRE's own
  registration-entry schema carries a `dns_names` field for exactly this purpose — [SPIRE API SDK:
  `entry.proto`](https://github.com/spiffe/spire-api-sdk/blob/main/proto/spire/api/types/entry.proto) — and
  Teleport's own docs describe using this same lever explicitly for Postgres compatibility: *"you can issue
  X509 SVIDs with a DNS SAN which can then be mapped to database user... If DNS SANs have been requested,
  the first DNS SAN is set as the subject common name. This behavior exists to support interoperability with
  legacy systems... An example of one such legacy system is Postgres."* — [Teleport: Workload Identity Best
  Practices](https://goteleport.com/docs/machine-workload-identity/workload-identity/best-practices/).
- **CloudNativePG can be configured to trust a custom external CA (e.g., a SPIRE/Teleport trust-domain CA)
  for client certificates — but this replaces, not supplements, the operator's own generated client CA for
  the whole cluster, confirmed directly against CloudNativePG's own docs, and combined with its own
  documented, fully general `pg_hba`/`pg_ident` customization points this makes the pattern mechanically
  viable end to end.** *"To use a custom CA to verify client certificates for a cluster, you must specify
  the following parameters: `replicationTLSSecret`... `clientCASecret` – The name of a secret containing the
  `ca.crt` key of the CA to use to verify client certificate,"* and doing so means *"the cluster isn't in
  control of the client CA secret key"* any more — [CloudNativePG docs:
  Certificates](https://cloudnative-pg.io/docs/devel/certificates). CNPG's `.spec.postgresql.pg_hba` field
  accepts arbitrary user-defined `pg_hba.conf` rules (e.g. `hostssl app app 10.244.0.0/16 md5`, CNPG's own
  worked example) inserted right after the operator's own fixed rules, and `.spec.postgresql.pg_ident`
  accepts arbitrary CN-remapping rules the same way CNPG already documents for its own internal
  `streaming_replica` user — [CloudNativePG docs: PostgreSQL
  Configuration](https://cloudnative-pg.io/docs/devel/postgresql_conf). Net: viable, but only via the CN/DN
  bridge above (a SPIFFE-aware `cert` rule, not a SPIFFE-native one), and adopting a single custom
  `clientCASecret` cluster-wide means every client certificate CNPG verifies for that cluster — including
  its own internal replication user — must come from that same CA.

---

## Question 1: Teleport Workload Identity

### What it actually is and does

Teleport's own introduction describes Workload Identity as a first-class, SPIFFE-conformant issuance
feature of a Teleport cluster, not a bolt-on:

> "Teleport Workload Identity securely issues short-lived cryptographic identities to workloads. It is a
> flexible foundation for workload identity across your infrastructure, creating a uniform way for your
> workloads to authenticate regardless of where they are running... Teleport Workload Identity is
> compatible with the open-source Secure Production Identity Framework For Everyone (SPIFFE) standard. This
> enables interoperability between workload identity implementations and also provides a wealth of
> off-the-shelf tools and SDKs to simplify integration with your workloads."

— [Introduction to Workload
Identity](https://goteleport.com/docs/machine-workload-identity/workload-identity/introduction/). Mechanically,
this is a genuinely separate certificate authority from anything else in a Teleport cluster: *"Teleport
Workload Identity establishes a root certificate authority within your Teleport cluster that will be
responsible for issuing the short-lived JWTs and X509 certificates to workloads. These identities are also
known as SPIFFE Verifiable Identity Documents (SVIDs)"* — same source. Issuance is gated by Teleport's own
RBAC (Bots/Roles granted permission to request specific SPIFFE IDs), and delivered to workloads by **tbot**,
Teleport's agent, which "is installed in close proximity to workloads which require an identity" and can
either write SVIDs to disk/a Kubernetes Secret or "expose a SPIFFE Workload API endpoint" — the same
standardized gRPC API SPIRE uses — same source. tbot can also perform local **Workload Attestation**
(restricting issuance to, e.g., a specific pod or UID/GID), the same concept and same node-local scope as
SPIRE's own workload attestation (per #54's already-established distinction between node and workload
attestation).

Teleport's own docs are explicit that this is architecturally distinct from Teleport's original Zero Trust
Access/PAM product, both in what it protects and how it's consumed:

> "Teleport Machine & Workload Identity for Zero Trust Access primarily issues short-lived credentials to
> workloads to enable them to access resources secured by the Teleport cluster. The credentials issued are
> only compatible with Teleport itself, and access to resources must be through the Teleport Proxy. Teleport
> Workload Identity issues cryptographic identities that are compatible with the popular SPIFFE standard for
> interoperable workload identity. These identities are flexible enough to be used for a range of purposes.
> **The Teleport Proxy is not used for securing workload-to-workload communication.**"

— same source. This directly answers half of this repo's "standalone or full platform" question at the
data-plane level: SVIDs, once issued, are consumed peer-to-peer between workloads (mTLS, JWT bearer to
third parties) with no Teleport Proxy in the traffic path at all — structurally the opposite of Istio
ambient's ztunnel-mediated design that #54's research already found unusable for this repo's purpose.

### Operational footprint: standalone feature, or the whole platform?

The control-plane side of the "standalone or full platform" question is less clean-cut than the data-plane
side. Every Workload Identity deployment guide checked by this research (Getting Started, both Kubernetes
join-method guides, both AWS federation guides) states the identical prerequisite:

> "A running Teleport cluster accessible at a hostname with a valid TLS certificate."

— e.g. [Getting Started with Workload
Identity](https://goteleport.com/docs/machine-workload-identity/workload-identity/getting-started/). Teleport's
own architecture doc defines exactly what that means:

> "The Teleport **control plane** consists of the Teleport Auth Service and Teleport Proxy Service... The
> Teleport Auth Service performs three main functions: Maintains certificate authorities that sign host and
> client certificates... Stores cluster configurations... Collects cluster data such as audit events and
> session recordings... The Teleport Proxy Service enables components in a Teleport cluster to communicate
> securely with the Teleport Auth Service. With the Proxy Service, users can use the public internet to
> access infrastructure in private networks."

— [Teleport Architecture](https://goteleport.com/docs/reference/architecture/). So "just the Workload
Identity feature" still means running both of these services — there is no smaller, Workload-Identity-only
binary or deployment mode documented anywhere this research found. In practice this means the session
recording, audit log, and SSH/Kubernetes/database bastion features of the Auth and Proxy Services would be
present and running even if entirely unused for anything but issuing SVIDs to tbot Bots — genuine, if
partly idle, additional surface compared to a purpose-built issuer.

That said, the footprint of running that control plane at minimum is materially lighter than #54's research
already found for SPIRE. Teleport's own storage-backend docs describe the default, out-of-the-box
configuration as a single local instance, not an HA-first design:

> "A Teleport cluster stores different types of data in different locations. **By default everything is
> stored in a local directory on the Auth Service host.** For self-hosted Teleport deployments, you can
> configure Teleport to integrate with other storage types... core cluster state ... Local directory
> (SQLite), etcd, PostgreSQL, Amazon DynamoDB, GCP Firestore, CockroachDB... **To run multiple instances of
> the Teleport Auth Service, you must switch to one of the high-availability storage backends listed below
> first.**"

— [Storage Backends](https://goteleport.com/docs/reference/deployment/backends/). This is the inverse
framing from SPIRE's own scaling docs, which (per #54's research) treat a 2-server topology as the floor
even for the smallest documented reference deployment. Teleport's default is one Auth Service instance with
a local SQLite-like directory; HA is an explicit, opt-in upgrade requiring an operator to switch storage
backends first, not a stated starting requirement.

Licensing is not a blocker for the core capability: Teleport's GitHub repository is licensed **AGPL-3.0**
(confirmed directly via GitHub's own repository metadata), and Teleport's own feature matrix places the
core Workload Identity capabilities — Service Discovery, Issuance, Secretless Authentication, Ephemeral
Authorization, Auditability, and "Open Standards - JWT, SPIFFE, x509 and others" — in the free, self-hosted
**Community Edition** column, alongside Enterprise (Cloud) and Enterprise (Self-Hosted) — [Teleport Feature
Matrix](https://goteleport.com/docs/feature-matrix/). The same matrix places **HSM and TPM support**,
**External PKI integration** ("Configure an external PKI hierarchy to use for issuing SPIFFE SVIDs"), and
**Sigstore attestation** in the Enterprise-only columns — genuinely gated capabilities, but none that block
the basic "issue SPIFFE SVIDs to workloads across a fleet" use case this repo needs.

One capability genuinely is Enterprise-gated and directly relevant to a "one unified trust domain across
three clusters" design: cross-trust-domain **SPIFFE Federation**.

> "This page describes the capabilities that Teleport offers for federating Workload Identity SPIFFE...
> **Teleport Enterprise Required** — A valid Teleport Enterprise license is required to use the federation
> features of Teleport Workload Identity."

— [SPIFFE Federation](https://goteleport.com/docs/machine-workload-identity/workload-identity/federation/). It
is important to be precise about what this gates, per the same doc: Federation is for establishing trust
**between two separate trust domains** ("a trust domain managed by Teleport Workload Identity could
federate with a trust domain managed by SPIRE... Federation relationships are 'one way'"), exposed via a
`/webapi/spiffe/bundle.json` SPIFFE Bundle Endpoint on the Proxy Service. This is not the same thing as
running **one** Teleport cluster/trust domain with tbot Bots deployed across all three of this repo's
clusters — that is a single-trust-domain topology (the shape #54's research already found SPIRE's own
"Single Trust Domain" option to be the simplest fit for this repo's "one unified identity" goal), and no
Enterprise gate was found anywhere in this research blocking multiple Kubernetes clusters' tbot agents from
joining one Community Edition Teleport cluster. Federation would only become relevant if this repo needed
to bridge to an entirely separate organization's trust domain — not its current need.

### Talos/Omni fit: how Teleport attests, compared point-for-point against #57's SPIRE findings

Teleport's own join-methods reference lists Kubernetes joining as three explicit variants, and each maps
onto a structurally distinct network/trust dependency — independently confirming, and in one case sidestepping,
the exact asymmetry #57's research already found between SPIRE's `k8s_psat` and `join_token` attestors.

**Kubernetes in-cluster** — the live-TokenReview variant, structurally identical to SPIRE's `k8s_psat`
problem for this repo's topology:

> "Kubernetes in-cluster joining is available for any Teleport process running in the same Kubernetes
> cluster as the Auth Service. It uses the Kubernetes ServiceAccount tokens to validate the pod identity.
> The method relies on the **Kubernetes TokenReview API** which is typically only reachable from within the
> Kubernetes cluster. Because of this limitation, **this join method is only available for self-hosted
> Teleport clusters in Kubernetes**."

— [Join Methods](https://goteleport.com/docs/reference/deployment/join-methods/). Read literally, this
variant only works when the Auth Service and the attesting tbot process share the *same* cluster — exactly
the scenario #57's research already established doesn't fit this repo's actual shape (Teleport Auth Service
on the platform cluster; tbot agents needed on the External and Internal workload clusters too). Using this
variant across clusters would require the same kind of ongoing, per-attestation, Omni-proxy-gated
cross-cluster Kubernetes-API credential #57 already found for SPIRE's `k8s_psat` — this research found no
indication Teleport's in-cluster variant is designed to work any other way.

**Kubernetes JWKS (`static_jwks`)** — the one variant with no counterpart in #54's or #57's SPIRE research,
and the one that structurally avoids the ongoing cross-cluster dependency entirely:

> "Kubernetes JWKS joining is available for any Teleport process running in Kubernetes. **The Auth Service
> does not have to run in Kubernetes so this method can be used with any Teleport cluster**, including
> Teleport Cloud. This join method works by exporting the public Kubernetes signing keys and using them to
> validate Kubernetes SA token signatures. **The signature validation can be performed by an Auth Service
> without access to the Kubernetes** [cluster]."

— same source. Configuration is a one-time, pasted JWKS blob (`kubectl get --raw /openid/v1/jwks`) embedded
directly in the join token resource — verified entirely offline by the Auth Service's own cryptographic
check against that stored public key, with **no live outbound call to the workload cluster's Kubernetes API
at attestation time, ever**. The one documented cost is key rotation: *"After rotating the Kubernetes CA,
you must update the Kubernetes JWKS tokens to contain the new Kubernetes signing keys (update the
`spec.kubernetes.static_jwks.jwks` field)"* — same source. In this repo's terms: fetching the workload
cluster's JWKS is an occasional, operator-driven `kubectl get --raw` through Omni's already-proven,
already-authenticated proxy path (per #57's own finding that this specific raw-GET traverses Omni's proxy
today) — not an ongoing, live, per-join credential the identity control plane itself must hold against a
foreign cluster's API server the way SPIRE's `k8s_psat` needs. Whether or how frequently Omni itself rotates
the `cluster.serviceAccount` signing key it owns (per #54's and #57's already-established finding that Omni
generates and now actively guards this key) was not found documented by this research — an honest gap, not
resolved here — but even in the worst case this is a bounded, occasional, human-driven refresh, not a
standing service-to-service credential.

**Kubernetes OIDC** — the variant that inherits the same public-reachability requirement #54's research
already found for AWS IRSA, and that #57's research already found Omni does not satisfy today:

> "Kubernetes OIDC joining is available for any Teleport process running in Kubernetes where the cluster
> issues service account tokens from a **publicly accessible**, OIDC-compliant issuer... This feature makes
> use of the Kubernetes Service Account Issuer Discovery feature... Unlike the `static_jwks` variant
> described above, this method fetches JWKS keys from the upstream provider dynamically and does not need
> to be reconfigured if keys are rotated... However, **not all Kubernetes implementations have accessible
> OIDC endpoints**."

— [Join Methods](https://goteleport.com/docs/reference/deployment/join-methods/). The setup guide's own
verification procedure underlines that "publicly accessible" is meant literally: *"Note that this should be
run over the public internet, such as your home internet connection, to help ensure the endpoint will be
accessible to Teleport."* — [Kubernetes
OIDC](https://goteleport.com/docs/machine-workload-identity/deployment/kubernetes-oidc/). This is exactly the
gap #57's research already found for Omni: Omni's workload-cluster discovery/JWKS endpoints resolve today to
internal-only SideroLink/pod-network addresses, unreachable by any caller lacking an already-authenticated
Omni session, with no anonymous path — confirmed live by a Sidero Labs maintainer in
[siderolabs/omni#2266](https://github.com/siderolabs/omni/issues/2266) (per #57's research). Teleport's
Kubernetes OIDC join method would hit this same wall, unchanged, unless and until
[siderolabs/omni#2266](https://github.com/siderolabs/omni/issues/2266) ships.

**Net comparison for #58**: Teleport's `static_jwks` join method is a genuinely different, and for this
repo's Talos/Omni topology structurally lighter, option than anything SPIRE offers for automatic
Kubernetes-based node attestation — it has no equivalent of SPIRE's `k8s_psat` TokenReview dependency, while
still avoiding `join_token`'s per-node manual-registration burden (the JWKS is fetched and registered once
per *cluster*, not once per node). Its cost (occasional, manual JWKS refresh on key rotation) is real but
bounded and occasional, not ongoing and per-attestation.

### AWS/OpenBao federation mechanics

Teleport's AWS OIDC Federation guide describes a discovery-endpoint model architecturally equivalent to
SPIRE's own OIDC Discovery Provider (per #54's research), but hosted by an existing Teleport component
rather than a dedicated new one:

> "When configuring the [AWS OIDC] provider, you need to specify the issuer URI. This will be the public
> address of your Teleport Proxy Service with the path `/workload-identity` appended. **Your Teleport Proxy
> Service must be accessible by AWS in order for OIDC federation to work.**"

— [AWS OIDC
Federation](https://goteleport.com/docs/machine-workload-identity/workload-identity/aws-oidc-federation/). The
same doc's worked Terraform/console examples confirm this resolves to an ordinary `aws_iam_openid_connect_provider`
resource with `url = "https://<proxy-hostname>/workload-identity"` and `client_id_list = ["sts.amazonaws.com"]`
— mechanically identical in shape to any other OIDC federation this repo has already surveyed (AWS IRSA,
SPIRE's own OIDC Discovery Provider, or any of #56's identity-broker candidates). Because this endpoint is
served by Teleport's own Proxy Service — an ordinary application this repo would run and expose itself, not
a Kubernetes API server's own issuer endpoint gated by ADR 0011's Omni-proxy restriction — it is exposable
the same way #56's research already established for identity-broker candidates: via Cloudflare Tunnel, with
no dependency on Omni's WireGuard proxy at all for this specific traffic.

Teleport also supports **AWS Roles Anywhere** (X.509-SVID → AWS credential exchange, rather than JWT-SVID →
credential exchange) as an alternative path, with the tradeoff noted directly in Teleport's own docs — *"Roles
Anywhere does not require the Teleport Proxy Service to be reachable by AWS, whereas OIDC Federation
does"* — [AWS Roles
Anywhere](https://goteleport.com/docs/machine-workload-identity/workload-identity/aws-roles-anywhere/). Per
this ticket's own scope instructions, AWS IAM Roles Anywhere itself was already considered and rejected
during #55's grilling (not cloud-agnostic) and is not re-litigated here; it is noted only because Teleport's
own docs frame it as the X.509 counterpart to its JWT-based AWS OIDC Federation path.

No Teleport-specific OpenBao or HashiCorp Vault integration doc, plugin, or guide was found anywhere in
Teleport's own documentation site (`goteleport.com/docs`) or its published `llms.txt` product summary — the
strings "Vault" and "OpenBao" appear only in Teleport's own unrelated "Vault-Free Privileged Access
Management" marketing framing, not in connection with Workload Identity. This is not a gap in practice,
though: Teleport's JWT-SVID is an ordinary OIDC-compliant JWT with a standard discovery document and JWKS
endpoint at the same `/workload-identity` path used for AWS, and OpenBao's own `jwt` auth method (already
confirmed by #54's research to be a generic, unbranded, structurally SPIFFE-capable mechanism driven by an
arbitrary `oidc_discovery_url`) would consume it exactly the same way it would consume any other OIDC
issuer — SPIRE's, Teleport's, or otherwise. This is reasoned from #54's already-established OpenBao facts
plus Teleport's own confirmed discovery-endpoint mechanics, not itself a documented Teleport↔OpenBao
integration guide.

---

## Question 2: other credible SPIFFE-compatible workload-identity control planes

### Search approach

This research searched beyond the platforms already named anywhere on this map (SPIRE, Teleport, and the
identity-broker candidates #56 already ruled out as a family) for any other self-hostable control plane
that issues portable, SPIFFE-format X.509 or JWT credentials directly to workloads across a multi-cluster
fleet. This included checking SPIFFE's own project ecosystem links (spiffe.io's own homepage links directly
to only one third-party implementation outside SPIRE — Teleport, already covered above, and Red Hat's
OpenShift operator, covered below), a targeted GitHub topic search (`topic:spiffe`), and following up on
every genuinely distinct-sounding project surfaced by that search.

### Athenz — the one credible, distinct, partially-SPIFFE-ID-compatible implementation found

**What it is.** Athenz is a Yahoo-originated, now Linux-Foundation-adjacent, CNCF-hosted platform
predating SPIFFE, described on its own site as an *"Open source platform for X.509 certificate based
service authentication and fine grained access control in dynamic infrastructures"* —
[athenz.io](https://www.athenz.io/). It is composed of three self-hosted components — a Management Server
(ZMS, Java), a Token Service (ZTS, Java), and a Node.js UI — and is Apache-2.0 licensed (confirmed via
GitHub's own repository license metadata for `AthenZ/athenz`), actively maintained (last push within the
week of this research).

**SPIFFE-ID compatibility, and where it falls short of full SPIFFE conformance.** Athenz's own published
comparison page against SPIRE is the clearest, most direct primary source found on this exact question:

> "**Full SPIFFE Standard Implementation** — Support for SPIFFE ID URIs: **only in X.509 Certs** (Athenz) /
> Yes (SPIRE). Issue both identity JWT Tokens and X.509 certificates: X.509 Certificates (Athenz) / Yes
> (SPIRE)... The SPIFFE standard defines how services identify themselves using IDs implemented as Uniform
> Resource Identifiers (URIs), how they're included in SPIFFE Verifiable Identity Document (SVIDs) such as
> X.509 Certificates and an API specification for issuing and/or retrieving SVIDs known as the **Workload
> API**. Spire is the reference implementation of SPIFFE specifications thus supports the above listed
> items. **Athenz supports issuing X.509 Certificates to registered services with SPIFFE IDs as URIs,
> however it does not implement the Workload API**s. Athenz provides its own REST API that agents use to
> retrieve certificates and provide them to services as PEM encoded files on disk. Athenz only issues X.509
> Certificates which allows us to enforce that all services within the organization use mTLS."

— [Athenz vs. SPIRE Comparison](https://www.athenz.io/comparison.html). So Athenz is a genuine, distinct
SPIFFE-ID-URI issuer — it can put a `spiffe://` URI in a certificate's SAN — but it is not a full SPIFFE
implementation: no standardized Workload API (workloads/tbot-equivalents integrate against Athenz's own,
non-standard REST API instead), and no JWT-SVID format at all, only X.509. The same page describes Athenz's
own Kubernetes attestation mechanism as a separate, purpose-built component rather than a documented
Talos-neutral mechanism: *"`k8s-athenz-identity` is a Kubernetes control plane component which aims to
securely provision unique Athenz identities (X.509 certificates) for pods"* — same source — with no
Talos-specific documentation or precedent found by this research either way.

**Maturity, relative to SPIFFE/SPIRE.** Athenz holds CNCF **Sandbox** status — the entry tier, well below
SPIFFE/SPIRE's own **Graduated** status (per #54's already-established finding):

> "Athenz was accepted to CNCF on January 26, 2021 at the Sandbox maturity level."

— [CNCF: Athenz](https://www.cncf.io/projects/athenz/). Athenz's own comparison page is candid about the
practical consequence of this: *"Spire has a big user community and is hosted by [CNCF] as an
incubation-level project. While Athenz powers most of workloads deployed within Yahoo with identity
certificates, it is just starting to focus on building its user community by joining CNCF and applying as a
sandbox-level project."* (Note: Athenz's own page describes SPIRE as "incubation-level" — this research
independently confirmed via CNCF's own SPIFFE project page, per #54's research, that SPIFFE/SPIRE actually
holds the higher **Graduated** tier; Athenz's own comparison text appears to understate SPIRE's maturity
relative to CNCF's current listing, a discrepancy worth flagging rather than silently resolving.)

**Bottom line for Athenz**: a real, self-hostable, actively-maintained, distinct alternative that partially
satisfies "SPIFFE-format X.509 credential to workloads," but with a materially narrower feature set (no
Workload API, no JWT-SVID, its own bespoke REST integration surface) and a lower CNCF maturity tier than
either SPIRE or SPIFFE/Teleport's own conformance. This research found no reason to prefer it over SPIRE or
Teleport on capability grounds; it is presented here because #58's own instructions ask for an active
search, and this is the one credible distinct implementation that search surfaced.

### Other projects found and ruled out as SPIRE repackagings, not distinct implementations

Three further SPIFFE-adjacent projects surfaced by this search were checked directly against their own
primary sources and found to be built *on top of* upstream SPIRE rather than independent implementations —
not credible new candidates for this ticket's "not yet considered" ask, since #54's research already covers
SPIRE itself:

- **Red Hat's Zero Trust Workload Identity Manager** (an OpenShift Operator) — its own documentation's table
  of contents names its constituent parts explicitly: *"12.1.2. SPIRE Server / 12.1.3. SPIRE Agent...
  12.2.1. SPIFFE CSI Driver / 12.2.2. SPIRE OpenID Connect Discovery Provider / 12.2.3. SPIRE Controller
  Manager"* — [Red Hat: Zero Trust Workload Identity
  Manager](https://docs.redhat.com/en/documentation/openshift_container_platform/latest/html/security_and_compliance/zero-trust-workload-identity-manager). This
  is an Operator that deploys and manages upstream SPIRE's own components for OpenShift specifically — the
  identical implementation #54's research already covers, packaged for one Kubernetes distribution this
  repo does not run (Talos, not OpenShift).
- **Cofide's `cofidectl`** — its own README states plainly: *"`cofidectl` is a command-line tool that makes
  it easy to install and manage workload identity providers for Kubernetes... **It builds on
  SPIFFE/SPIRE**... At Cofide, we're building a workload identity platform... [that] builds on
  SPIFFE/SPIRE"* — [`cofidectl`
  README](https://github.com/cofide/cofidectl/blob/main/README.md). An installation/orchestration
  abstraction over SPIRE, not a distinct issuance implementation.
- **HPE's Galadriel** — explicitly scoped as a federation-management hub for multiple SPIRE Server trust
  domains, not an issuer of its own: *"Project Galadriel is an open-source project that streamlines the
  configuration of Federation relationships among SPIRE Servers... **Alternative approach to SPIRE
  Federation**: Galadriel is built on top of SPIRE APIs..."* and is explicitly pre-production: *"Current
  Stage: Proof of Concept... not ready for production use"* — [Galadriel
  README](https://github.com/HewlettPackard/galadriel/blob/main/README.md).

A handful of other SPIFFE-ecosystem projects surfaced by the same search (`spiffe/spike`, a SPIFFE-authenticated
secrets store; `bloomberg/vault-auth-spire` and `philips-labs/spiffe-vault`, both HashiCorp Vault
authentication plugins; Ghostunnel, a sidecar proxy Teleport's own best-practices doc names for workloads
that can't integrate SPIFFE natively) were checked briefly and found to be **consumers** of an existing
SPIFFE identity (relying parties or proxies), not control planes that themselves attest workloads and issue
SVIDs — out of scope for this question's specific ask.

---

## Question 3: PostgreSQL/CloudNativePG client-certificate authentication compatibility

### PostgreSQL's native `cert` method: Common Name or Distinguished Name only, never a URI SAN

PostgreSQL's own current documentation (checked against the "Current" / v18 docs, the same version series
also covering the in-development v19) is unambiguous and leaves no SAN-based option undocumented:

> "This authentication method uses SSL client certificates to perform authentication... The `cn` (Common
> Name) attribute of the certificate will be compared to the requested database user name, and if they
> match the login will be allowed. User name mapping can be used to allow `cn` to be different from the
> database user name."

— [PostgreSQL docs: Certificate
Authentication](https://www.postgresql.org/docs/current/auth-cert.html). The `pg_hba.conf` reference names
the complete set of matching modes, and confirms there are exactly two, neither of which is SAN-based:

> "On any record using client certificate authentication (i.e. one using the `cert` authentication method or
> one using the `clientcert` option), you can specify which part of the client certificate credentials to
> match using the `clientname` option. This option can have one of two values. **If you specify
> `clientname=CN`, which is the default, the username is matched against the certificate's Common Name
> (CN)**. If instead you specify `clientname=DN` the username is matched against the entire **Distinguished
> Name (DN)** of the certificate... The comparison is done with the DN in RFC 2253 format."

— [PostgreSQL docs: The `pg_hba.conf`
File](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html). The same doc separately confirms
`clientcert=verify-full` is "similar to the `cert` authentication method" and can be layered on top of any
other `hostssl`-compatible authentication method (e.g. `scram-sha-256`) — but it inherits the identical
CN/DN-only matching rule, not a separate one. **No mention of Subject Alternative Names, URI SANs, or
anything resembling a SPIFFE ID appears anywhere in either document.** This directly and unambiguously
answers the ticket's question: PostgreSQL's native `cert` authentication does not read or map a certificate's
URI SAN to a role by any documented mechanism, in any current version — only the Subject's CN or full DN.

### The bridge: an optional DNS SAN, permitted by the SPIFFE spec itself, promotable to a Postgres-visible CN

This is not a dead end, and not merely a workaround invented by one vendor — it is explicitly accommodated
by the SPIFFE X.509-SVID specification itself:

> "An X.509 SVID MUST contain exactly one URI SAN, and by extension, exactly one SPIFFE ID... **An X.509
> SVID MAY contain any number of other SAN field types, including DNS SANs.**... Leaf certificate SPIFFE IDs
> MUST have a non-root path component. **The Subject field is not required**, however the URI SAN extension
> MUST be marked as critical if Subject is omitted."

— [SPIFFE X.509-SVID
specification](https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md). This means a
spec-conformant X.509-SVID is free to carry an *additional*, non-SPIFFE DNS SAN alongside its mandatory
`spiffe://` URI SAN — and both implementations surveyed in this document expose a lever for setting one.
SPIRE's own registration-entry schema carries a dedicated field for exactly this: *"A list of DNS names
associated with the identity described by this entry"* (`dns_names`, `repeated string dns_names = 10`) —
[SPIRE API SDK:
`entry.proto`](https://github.com/spiffe/spire-api-sdk/blob/main/proto/spire/api/types/entry.proto). Teleport's
own docs describe this exact mechanism, used explicitly for Postgres compatibility, in its own words:

> "When the X509 SVIDs are issued by Teleport Workload Identity, the subject distinguished name of the
> certificate is determined by the following criteria: If no DNS SANs have been requested, the subject is
> unset. If DNS SANs have been requested, the first DNS SAN is set as the subject common name. This
> behavior exists to support interoperability with legacy systems which are not able to parse DNS SANs or
> which are not SPIFFE aware. An example of one such legacy system is Postgres. Postgres supports client
> authentication using certificates, but only allows the common name to be used to determine which database
> user access should be granted to. To integrate Teleport Workload Identity with Postgres, you can issue
> X509 SVIDs with a DNS SAN which can then be mapped to database user. For example, you could issue a
> certificate with a DNS SAN of `myuser.mydb.db-access.example.com`. The behavior described above will then
> set the common name to this DNS SAN, and you can then configure Postgres to map this common name to
> `myuser`."

— [Teleport: Workload Identity Best
Practices](https://goteleport.com/docs/machine-workload-identity/workload-identity/best-practices/). The
important caveat, confirmed by the same source's first sentence: a **bare, spec-minimal** SPIFFE X.509-SVID
(URI SAN only, no DNS SAN requested) has **no Subject at all** ("the subject is unset") — such a certificate
would not satisfy Postgres's `cert` auth out of the box, since Postgres has nothing to compare against a
role name. The DNS-SAN-to-CN promotion is a deliberate, documented accommodation an operator must actively
request when issuing the credential, not something that happens automatically from adopting SPIFFE alone.
Whether SPIRE's own issuance path automatically promotes a registered `dns_names` entry into the certificate
Subject/CN the same way Teleport's docs describe doing was not confirmed by this research — SPIRE's own
node-attestor and entry-schema docs consulted here describe the field's existence, not this specific
promotion behavior — an honest gap, not resolved either way.

### CloudNativePG: a custom client CA is supported, but replaces (not supplements) the operator's own

CloudNativePG's own certificates documentation describes its default behavior and the fully-documented
override path plainly:

> "CloudNativePG was designed to natively support TLS certificates... it primarily operates in two modes:
> **Operator managed** – Certificates are internally managed by the operator... signed using a CA created
> by CloudNativePG. **User provided** – Certificates are generated outside the operator and imported in the
> cluster definition as secrets."

— [CloudNativePG docs: Certificates](https://cloudnative-pg.io/docs/devel/certificates). For the client-cert
side specifically (the side that matters for an app authenticating to Postgres, as distinct from the
server-cert side that matters for `sslmode=verify-full` already decided in ADR 0010):

> "If required, you can also provide the two client certificates, generating them using a separate
> component such as cert-manager or HashiCorp vault. **To use a custom CA to verify client certificates for
> a cluster, you must specify the following parameters:** `replicationTLSSecret` – The name of a secret...
> containing the client certificate for user `streaming_replica`... `clientCASecret` – The name of a secret
> containing the `ca.crt` key of the CA to use to verify client certificate."

— same source. This is a direct, affirmative confirmation: yes, CNPG can be pointed at an arbitrary external
CA — a SPIRE trust-domain CA, a Teleport Workload Identity CA, or any other — to verify client certificates.
The same doc is explicit that this is a full replacement of the operator's own client CA for that cluster,
not an additional, parallel trust anchor: *"As the cluster isn't in control of the client CA secret key,
you can no longer generate client certificates using `kubectl cnpg certificate`"* — same source — and CNPG's
own worked cert-manager example shows the internal `streaming_replica` replication client certificate itself
being reissued from that same custom CA/issuer, confirming the swap is cluster-wide, covering CNPG's own
internal replication traffic as well as any app-facing rule an operator adds. **This directly answers "alongside
or instead of": CNPG supports exactly one client CA trust anchor per `Cluster` at a time — instead of, not
alongside** — an operator adopting a SPIFFE trust-domain CA here would need to also reissue the cluster's
own internal `streaming_replica` certificate from that same CA (a documented, supported pattern, per CNPG's
own cert-manager example), not maintain two independently-trusted client CAs simultaneously.

The remaining piece — actually authenticating an *application* role (not just CNPG's own internal
`streaming_replica` user) via `cert` — is separately, fully supported through CNPG's own generic
`pg_hba`/`pg_ident` customization points, confirmed against the same documentation set used by ADR 0010:

> "`pg_hba` is a list of PostgreSQL Host Based Authentication rules used to create the `pg_hba.conf` used by
> the pods... the `pg_hba.conf` file generated by the operator can be seen as composed of four sections:
> Fixed rules / User-defined rules / Optional LDAP section / Default rules... Inside the cluster manifest,
> `pg_hba` lines are added as list items in `.spec.postgresql.pg_hba`, as in the following excerpt:
> `postgresql: pg_hba: - hostssl app app 10.244.0.0/16 md5`."

— [CloudNativePG docs: PostgreSQL
Configuration](https://cloudnative-pg.io/docs/devel/postgresql_conf). The same doc documents CN-remapping
via `pg_ident.conf` for CNPG's own internal `streaming_replica` user already (`cnpg_streaming_replica` named
map, driven by `.spec.postgresql.pg_ident`) — the identical mechanism an operator would reuse, unmodified, to
map an app workload's SVID-derived Common Name (per the DNS-SAN bridge above) onto that app's own database
role, alongside a custom `hostssl <db> <app-role> all cert` (or `clientcert=verify-full`) rule in
`.spec.postgresql.pg_hba`.

### Net verdict for #58

Mechanically viable end to end, confirmed against PostgreSQL's and CloudNativePG's own docs: an app could
authenticate to its CNPG-hosted Postgres database using its own SPIFFE X.509-SVID instead of ADR 0010's
current static password Secret, **provided** the issuing control plane (SPIRE or Teleport, per Questions 1–2)
is configured to attach a Postgres-role-mappable DNS SAN to that workload's SVID (promoted to the
certificate's Subject CN, the mechanism both SPIRE's registration-entry schema and Teleport's own
documented behavior support), **and** the CNPG `Cluster`'s single `clientCASecret` is pointed at that same
trust domain's CA (replacing, not adding to, CNPG's own default client CA for the whole cluster, including
its internal replication traffic), **and** a corresponding `pg_hba`/`pg_ident` rule is added via CNPG's own
already-general customization fields. This is a nice-to-have capability confirmation only, per this ticket's
own scope — it does not expand #55's settled scope, and #58 can weigh it as a viable future option without
committing to it now.

---

## Recommendation

None — by design. This ticket's own instructions, and the wayfinder map's split between research and
decision tickets, place the actual implementation choice in [#58](https://github.com/aaronkyriesenbach/catalyst/issues/58).
What this research contributes to that decision:

- Teleport Workload Identity is a real, SPIFFE-conformant, separately-CA'd issuance feature, free and
  self-hostable under Community Edition (AGPL-3.0) for the core capability — but "just the feature" still
  means running Teleport's Auth Service and Proxy Service (its whole control plane, if not its bastion/PAM
  UI-facing features), with a lighter default (single-instance, local-SQLite) footprint than SPIRE's own
  documented 2-server HA floor.
- Teleport's three Kubernetes join-method variants map cleanly onto #57's SPIRE findings: in-cluster
  (live-TokenReview, same cross-cluster Omni-proxy cost as SPIRE's `k8s_psat`), static JWKS (a genuinely
  lighter, no-live-call alternative with no SPIRE equivalent, at the cost of manual re-registration on key
  rotation), and OIDC (blocked by the same Omni public-reachability gap #57 already found). Teleport's own
  AWS OIDC federation endpoint is hosted by its own Proxy Service — an ordinary, Cloudflare-Tunnel-exposable
  app, not gated by Omni's proxy the way a workload cluster's own discovery endpoint is. SPIFFE Federation
  (bridging separate trust domains) is Enterprise-gated, but this repo's actual need — one trust domain
  spanning three clusters — does not require it.
- An active search beyond this map's existing research found exactly one credible, distinct,
  self-hostable, partially-SPIFFE-compatible alternative — Athenz (CNCF Sandbox, X.509-only, no Workload
  API) — plus several SPIRE-repackaging/orchestration projects (Red Hat's Zero Trust Workload Identity
  Manager, Cofide, HPE Galadriel) that are not distinct implementations and were ruled out on that basis.
- PostgreSQL's native `cert` authentication reads only a certificate's Common Name or full Distinguished
  Name — never a URI SAN — confirmed directly against current PostgreSQL docs. The SPIFFE X.509-SVID spec
  itself permits an optional DNS SAN alongside the mandatory URI SAN specifically to bridge this gap, a
  lever both SPIRE's and Teleport's own issuance models expose. CloudNativePG can be pointed at a custom
  (e.g., SPIRE/Teleport trust-domain) client CA via `clientCASecret` — replacing, not supplementing, its own
  generated client CA cluster-wide — and its existing, already-general `pg_hba`/`pg_ident` customization
  points make app-level cert-based authentication mechanically viable on top of that. This is a viable
  nice-to-have, not a requirement, per this ticket's own scope.

---

## Sources

**Teleport**

- Introduction to Workload Identity — <https://goteleport.com/docs/machine-workload-identity/workload-identity/introduction/>
- Getting Started with Workload Identity — <https://goteleport.com/docs/machine-workload-identity/workload-identity/getting-started/>
- Introduction to SPIFFE (Teleport's own conceptual page) — <https://goteleport.com/docs/machine-workload-identity/workload-identity/spiffe/>
- JWT SVIDs — <https://goteleport.com/docs/machine-workload-identity/workload-identity/jwt-svids/>
- SPIFFE Federation — <https://goteleport.com/docs/machine-workload-identity/workload-identity/federation/>
- Workload Identity Best Practices (Postgres CN/DNS-SAN interoperability guidance) — <https://goteleport.com/docs/machine-workload-identity/workload-identity/best-practices/>
- AWS OIDC Federation — <https://goteleport.com/docs/machine-workload-identity/workload-identity/aws-oidc-federation/>
- AWS Roles Anywhere — <https://goteleport.com/docs/machine-workload-identity/workload-identity/aws-roles-anywhere/>
- Machine & Workload Identity FAQ — <https://goteleport.com/docs/machine-workload-identity/faq/>
- Machine & Workload Identity Use Cases — <https://goteleport.com/docs/machine-workload-identity/use-cases/>
- Deploy tbot — <https://goteleport.com/docs/machine-workload-identity/deployment/>
- Deploy tbot: Kubernetes (static JWKS) — <https://goteleport.com/docs/machine-workload-identity/deployment/kubernetes/>
- Deploy tbot: Kubernetes (OIDC) — <https://goteleport.com/docs/machine-workload-identity/deployment/kubernetes-oidc/>
- Teleport Architecture (Auth Service / Proxy Service control-plane definition) — <https://goteleport.com/docs/reference/architecture/>
- Storage Backends (default SQLite/local-directory, HA opt-in) — <https://goteleport.com/docs/reference/deployment/backends/>
- Join Methods reference (Kubernetes in-cluster / static JWKS / OIDC variants) — <https://goteleport.com/docs/reference/deployment/join-methods/>
- Teleport Feature Matrix (Community Edition vs. Enterprise capability gating) — <https://goteleport.com/docs/feature-matrix/>
- Teleport's own `llms.txt` product summary (checked for OpenBao/Vault-integration mentions) — <https://goteleport.com/llms.txt>
- `gravitational/teleport` GitHub repository (AGPL-3.0 license, confirmed via GitHub API metadata) — <https://github.com/gravitational/teleport>

**Other SPIFFE-compatible / SPIFFE-adjacent implementations surveyed**

- Athenz home page — <https://www.athenz.io/>
- Athenz vs. SPIRE Comparison (SPIFFE-ID support, Workload API gap, community-size framing) — <https://www.athenz.io/comparison.html>
- CNCF: Athenz project page (Sandbox maturity, acceptance date) — <https://www.cncf.io/projects/athenz/>
- `AthenZ/athenz` GitHub repository (Apache-2.0 license, activity, confirmed via GitHub API metadata) — <https://github.com/AthenZ/athenz>
- Red Hat: Zero Trust Workload Identity Manager (OpenShift Operator packaging upstream SPIRE) — <https://docs.redhat.com/en/documentation/openshift_container_platform/latest/html/security_and_compliance/zero-trust-workload-identity-manager>
- `cofidectl` README ("builds on SPIFFE/SPIRE") — <https://github.com/cofide/cofidectl/blob/main/README.md>
- Galadriel README (SPIRE-Server federation hub, Proof-of-Concept stage) — <https://github.com/HewlettPackard/galadriel/blob/main/README.md>
- SPIFFE project homepage (ecosystem/implementation links checked) — <https://spiffe.io/>
- GitHub topic search: `topic:spiffe` (candidate discovery) — <https://github.com/topics/spiffe>

**SPIFFE specification**

- SPIFFE X.509-SVID specification (mandatory URI SAN, optional DNS SANs, optional Subject field) — <https://github.com/spiffe/spiffe/blob/main/standards/X509-SVID.md>
- SPIRE API SDK `entry.proto` (`dns_names` registration-entry field) — <https://github.com/spiffe/spire-api-sdk/blob/main/proto/spire/api/types/entry.proto>

**PostgreSQL**

- Certificate Authentication (`cert` method, CN-only matching) — <https://www.postgresql.org/docs/current/auth-cert.html>
- The `pg_hba.conf` File (`clientcert`, `clientname=CN`/`clientname=DN`, no SAN-based option) — <https://www.postgresql.org/docs/current/auth-pg-hba-conf.html>

**CloudNativePG**

- Certificates (operator-managed vs. user-provided modes, `clientCASecret`, `replicationTLSSecret`) — <https://cloudnative-pg.io/docs/devel/certificates>
- PostgreSQL Configuration (`.spec.postgresql.pg_hba`, `.spec.postgresql.pg_ident`, fixed vs. user-defined rule sections) — <https://cloudnative-pg.io/docs/devel/postgresql_conf>

**catalyst repo (current-state context, treated as fixed inputs per this ticket's own instructions)**

- `docs/adr/0010-dbaas-provisioning-connectivity.md` — CNPG cross-cluster connectivity, current password-based `sslmode=verify-full` connection security decision
- `docs/adr/0011-cluster-registration-cross-cluster-auth.md` — Omni WireGuard-only Kubernetes-API-server reachability
- `docs/research/machine-identity-research.md` (branch `research/machine-identity-research`, [#54](https://github.com/aaronkyriesenbach/catalyst/issues/54)) — SPIRE `k8s_psat`/`join_token` attestation, 2-server HA floor, OpenBao `jwt`/`cert` auth-method findings, treated as fixed context
- `docs/research/identity-broker-machine-identity-research.md` (branch `research/identity-broker-machine-identity-research`, [#56](https://github.com/aaronkyriesenbach/catalyst/issues/56)) — identity-broker family (ruled out by #55), Cloudflare Tunnel exposure precedent for a broker's own OIDC endpoint
- `docs/research/omni-cross-cluster-identity-reachability-research.md` (branch `research/omni-cross-cluster-identity-reachability-research`, [#57](https://github.com/aaronkyriesenbach/catalyst/issues/57)) — Omni proxy scope, SPIRE `k8s_psat` cross-cluster TokenReview dependency, ADR-0010-style LAN path
- catalyst repo issues consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1) (wayfinder map), [#54](https://github.com/aaronkyriesenbach/catalyst/issues/54) (machine-identity research, closed), [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55) (mechanism-family decision, closed), [#56](https://github.com/aaronkyriesenbach/catalyst/issues/56) (identity-broker research, closed), [#57](https://github.com/aaronkyriesenbach/catalyst/issues/57) (Omni cross-cluster reachability research, closed), [#58](https://github.com/aaronkyriesenbach/catalyst/issues/58) (implementation-decision ticket this research feeds)
