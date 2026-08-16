# Secrets management: self-hosted OpenBao on the platform cluster

Status: accepted

Replace AWS Secrets Manager (AWS SM) as the **app-layer** secrets backend with self-hosted
[OpenBao](https://openbao.org/) — Vault's MPL-2.0, Linux-Foundation-hosted open-source fork — running on
the dedicated platform cluster ([#8](https://github.com/aaronkyriesenbach/catalyst/issues/8), ADR 0002).
External Secrets Operator (ESO) keeps its existing role, pointed at a new `ClusterSecretStore` backed by
OpenBao's first-party ESO provider instead of the `aws` provider.

This is not a cost decision — at catalyst's scale AWS SM's ~$2–5/month is negligible, and the standing
"free-tier-first but cheap-is-fine-with-justification" preference doesn't rule it out. The deciding
factor is **rotation**: ESO's own `ClusterGenerator`/`Password` pattern (used today for auto-generated
app/DB passwords) only generates a value once — it has no rotation story regardless of which backend
sits behind it. OpenBao's **dynamic secrets engines** (e.g. the database secrets engine) generate
short-lived, lease-bound credentials that rotate automatically — a materially better fit for "auto-
generated and ideally rotated" than either ESO's static generator or AWS SM's rotation story (which would
require writing and maintaining custom Lambda rotation functions). OpenBao's **Static Key seal**
(`openbao.org/docs/configuration/seal/static/`) also removes plain HashiCorp Vault's worst homelab
failure mode — Shamir seal requiring manual unseal on every reboot — without needing a cloud KMS or a
second Vault instance. See the full survey: [research #10](https://github.com/aaronkyriesenbach/catalyst/issues/10),
`docs/research/secrets-research.md`.

**Bootstrap-layer secrets are unaffected.** Proxmox/TrueNAS/Unifi credentials and OpenTofu state remain
in AWS Secrets Manager per [ADR 0001](0001-bootstrap-layer-iac-tooling.md) — that boundary (bootstrap
OpenTofu owns the physical layer only) doesn't change. OpenBao only replaces the in-cluster, ESO-mediated
store for app-layer secrets.

**Topology**: single-node initially, on NAS-backed persistent storage (not node-local disk), so a
pod/node restart is an availability blip, not a data-loss event, given Static Key auto-unseal requires no
operator intervention to recover. Raft multi-node HA is deliberately deferred to when the platform
cluster reaches its own 3-control-plane-node target ([#7](https://github.com/aaronkyriesenbach/catalyst/issues/7),
ADR 0002) — the same trigger condition, not a separate one. Backup of OpenBao's Raft storage is deferred
to whichever backup/DR solution the platform ultimately adopts — that decision is still open (see
"Not yet specified" on the map), and is deliberately **not** assumed to be today's volsync/restic setup.

**Deliberately left open here**:

- The exact mechanism for OpenBao's own one-time bootstrap (`operator init`, then configuring the
  Kubernetes auth backend + policies for ESO) — a Helm post-install Job, a purpose-built Kubernetes
  operator, or something else. This is owned by whatever reconciles the platform cluster's apps, which is
  itself undecided (see the new GitOps/continuous-delivery-tool ticket) — explicitly **not** a second
  bootstrap-layer OpenTofu module, which would violate the same "bootstrap ends at cluster existence"
  boundary ADR 0001 already establishes one layer down.
- Human login to OpenBao (its OIDC auth method) is deferred until
  [#13](https://github.com/aaronkyriesenbach/catalyst/issues/13) (human identity provider) lands. This
  has no bearing on ESO's own access, which authenticates via the Kubernetes auth method (service-account
  based) — no IdP dependency either way.
- Which specific secrets migrate to dynamic-secrets-engine management (e.g. Postgres credentials via the
  database secrets engine) vs. staying as static KV-v2 + generator-issued values — an app-by-app call at
  migration time, consistent with the incremental cutover strategy
  ([#31](https://github.com/aaronkyriesenbach/catalyst/issues/31)).

## Considered Options

- **Keep AWS Secrets Manager** — rejected: no rotation story beyond ESO's one-shot generator or custom
  Lambda functions; cost was never the objection, so it wasn't the tiebreaker either.
- **Self-hosted HashiCorp Vault** — rejected: Shamir seal requires manual unseal after every reboot
  unless paying for a cloud KMS or running a second Vault purely for Transit auto-unseal; also now
  IBM-owned BSL, not open source.
- **Bitwarden Secrets Manager** — rejected: a real $0 free tier and a near drop-in ESO replacement, but
  it's still a *static* secrets store like AWS SM — no dynamic-secrets/rotation capability, so it doesn't
  address the actual decision driver.
- **Infisical / Doppler / SOPS+age / Sealed Secrets** — not pursued further: the git-native options
  (SOPS+age, Sealed Secrets) have no secret-generation equivalent at all; Infisical/Doppler are static
  stores with the same gap as Bitwarden.

## Consequences

- `apps/external-secrets.ts` gains an OpenBao `ClusterSecretStore` alongside (eventually replacing) the
  AWS one; the `ClusterGenerator`/`Password` pattern stays for secrets that don't need rotation.
- A new ticket, "Decide the GitOps/continuous-delivery tool and topology for the platform + workload
  clusters," is needed before OpenBao's own bootstrap sequencing can be designed — surfaced by this
  ticket, not resolved by it.
- `CONTEXT.md` gains a **Secrets store** entry contrasting bootstrap-layer (AWS SM) and app-layer
  (OpenBao) secrets.
- The platform cluster's service catalog (ADR 0002) now includes OpenBao as a named shared platform
  service.
