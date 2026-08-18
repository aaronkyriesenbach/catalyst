# Machine-identity implementation: SPIRE with `join_token` node attestation

Status: accepted

[Decide machine-identity mechanism for workload identity across the multi-cluster platform
(#55)](https://github.com/aaronkyriesenbach/catalyst/issues/55) settled the mechanism *family* — a
dedicated SPIFFE-based workload-identity control plane, not an identity-broker platform or this repo's
existing IRSA pattern. This ADR picks the specific implementation and the concrete node-attestation
mechanism on this repo's actual Talos/Omni fleet.

## Decision

- **Adopt SPIRE** (CNCF Graduated, the SPIFFE reference implementation) over Teleport Workload Identity
  and Athenz. Teleport's `static_jwks` join method is genuinely lighter-weight and structurally avoids any
  Omni-proxy dependency, but ties the platform to a commercial vendor's ecosystem; Athenz was ruled out
  outright (no Workload API, no JWT-SVID, CNCF Sandbox tier). Vendor neutrality won out given SPIRE's own
  attestation downside (below) turned out to be reversible, not structural.
- **Node attestation: `join_token`, not `k8s_psat`.** `k8s_psat` is automatic but requires the SPIRE
  Server to hold an *ongoing*, per-(re)attestation TokenReview credential against each workload cluster's
  live Kubernetes API — reachable only through Omni's WireGuard-tunneled proxy (ADR 0011). Adding that
  dependency here would undo the very thing this decision thread is trying to achieve: #47 and #49 (below)
  are moving *away* from needing Omni's proxy for cross-cluster auth, via this same SPIFFE credential.
  `join_token` (a one-time pre-shared secret, manually registered per node) has no such dependency, and
  its manual-registration cost is lower in practice than it first appears: SPIRE's `disk` KeyManager
  plugin persists an Agent's keypair/SVID across ordinary restarts, so re-registration is only needed at
  initial node provisioning, not on every Agent restart.
  - **Reversible, not a one-way door**: the SPIRE server can run both `join_token` and `k8s_psat`
    attestors simultaneously, and an individual node can be switched to `k8s_psat` later (config change +
    Agent restart, no server downtime) if Omni's availability story changes materially (see the Omni-HA
    fog entry on the map). This de-risked the vendor-neutrality pick — reconsidering later costs a config
    change, not a re-migration.
  - Considered re-litigating Omni's own deployment model (single VM vs. HA) instead of avoiding
    `k8s_psat` — rejected as a fix for *this* ticket: Sidero's own docs confirm the "Kubernetes deployment"
    tier alone doesn't meaningfully raise availability over a single VM, and the tier that would (full
    "Omni HA") needs a second, non-OpenBao-reusable HA secrets system plus a fourth, non-Omni-managed
    cluster to host it — disproportionate to fix one attestation mechanism's dependency. Whether Omni HA
    is worth it on its own merits (e.g., for #42's ArgoCD reconciliation) is tracked separately in the
    map's fog, not resolved here.
- **Also adopt app-to-Postgres X.509-SVID authentication**, replacing ADR 0010's password-based Secret,
  given this is already a large migration. Mechanically: SPIRE's `dns_names` registration-entry field
  attaches a Postgres-role-mappable DNS SAN alongside the mandatory `spiffe://` URI SAN; CNPG's
  `clientCASecret` is pointed at SPIRE's trust-domain CA (replacing, not supplementing, CNPG's own
  generated client CA cluster-wide, including its internal `streaming_replica` cert); a `pg_hba`/`pg_ident`
  rule maps the promoted Common Name to the app's database role.
  - **Open implementation risk, not yet confirmed**: whether SPIRE's issuance path actually promotes a
    registered `dns_names` entry into the SVID's Subject/CN the way Postgres needs (Teleport's equivalent
    behavior is explicitly documented; SPIRE's is not, per research). Verify against a running SPIRE
    instance before committing to this in implementation planning — ADR 0010's password Secret is the
    fallback if it doesn't pan out cleanly.
- **Composition with #47 and #49**: both re-pointed to block on this decision (per #55) resolve their
  identity-mechanism sub-questions as a direct consequence, without resolving in full:
  - [#49](https://github.com/aaronkyriesenbach/catalyst/issues/49) — ESO on a workload cluster
    authenticates to OpenBao via its SPIRE-issued JWT-SVID against OpenBao's already-generic `jwt` auth
    method (`oidc_discovery_url` pointed at a SPIRE OIDC Discovery Provider instance), instead of OpenBao's
    Kubernetes auth method (which would need the same cross-cluster TokenReview dependency this ADR just
    avoided). #49's remaining scope — where ESO itself runs, how secrets are actually distributed to
    consumers — stays open on that ticket.
  - [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47) — `external-dns`'s Route53 credential
    question resolves the same way: a SPIRE OIDC Discovery Provider federates to an AWS IAM OIDC Identity
    Provider, giving `external-dns` AWS credentials wherever it runs, without reusing #42's Omni-bearer-token
    mechanism or extending `irsa.md`. #47's broader routing questions (kube-vip/MetalLB IP assignment,
    internal DNS mapping across 3 clusters) are unrelated to identity and stay independently decided there.

## Considered Options

- **Teleport Workload Identity + `static_jwks`** — rejected: genuinely lighter control-plane footprint and
  no Omni-proxy dependency at all, but ties the platform to a commercial vendor's roadmap (free/AGPL-3.0
  Community Edition today, Enterprise upsell paths exist though unneeded here) instead of the vendor-neutral
  CNCF-Graduated reference implementation. Its per-*cluster* (not per-node) JWKS registration and
  explicitly-documented DNS-SAN-to-CN Postgres bridge were real points in its favor, but not enough to
  outweigh vendor neutrality once `join_token`'s downsides turned out to be reversible.
- **SPIRE + `k8s_psat`** — rejected: reintroduces an ongoing, live, Omni-proxy-gated cross-cluster
  TokenReview dependency, directly undoing this decision thread's own rationale for adopting SPIFFE in the
  first place.
- **Athenz** — rejected outright: no Workload API, X.509-only (no JWT-SVID), CNCF Sandbox maturity tier.
- **Reconsidering Omni's HA/deployment model** to make `k8s_psat` viable — rejected for this ticket's
  scope (see Decision above); split into the map's fog as a standing, separately-motivated question.

## Consequences

- SPIRE Server + Agent DaemonSet + SPIFFE CSI driver are new operational surface on the platform (Server)
  and every cluster (Agent) — the Server's namespace needs a Talos PSA `privileged` override
  (`spire-system`), the same category of friction already documented for MetalLB (not incurred by
  kube-vip).
- SPIRE Server's datastore is CNPG-hosted (reusing the existing DBaaS fleet, ADR 0006), not a new kind of
  database.
- Every node added to the fleet (platform, External workload, Internal workload clusters, and future
  growth per the map's hardware trajectory) needs a manual `join_token` generated and pushed to its SPIRE
  Agent config at provisioning time — a small, deliberate, per-node cost, not a recurring one.
- A SPIRE OIDC Discovery Provider needs to be stood up and exposed (for #47/#49's federation to AWS/OpenBao)
  — implementation detail for a future ticket, not decided here.
- ADR 0010's password-based Postgres Secret is superseded by X.509-SVID client-cert auth, contingent on
  confirming SPIRE's `dns_names`-to-CN promotion behavior during implementation planning; falls back to
  ADR 0010's mechanism unchanged if that doesn't hold up.
- #47 and #49 are updated (not closed) to reflect their identity-mechanism sub-questions being settled by
  this ADR, narrowing their remaining scope.
