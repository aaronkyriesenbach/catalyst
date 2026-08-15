# Research: secrets-management options

Ticket: [#10](https://github.com/aaronkyriesenbach/catalyst/issues/10) (wayfinder map [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1))

**Question**: survey secrets-management options for catalyst holistically — do
not assume the current AWS Secrets Manager + External Secrets Operator (ESO)
setup is kept. Evaluate for a **single-operator homelab**, free-tier-first but
cheap-is-fine-with-justification, weighing unlock-on-boot/HA story and ongoing
maintenance burden.

**Current state** (`apps/external-secrets.ts`): ESO installed as a Helm chart,
with a `ClusterSecretStore` (`aws-secrets-manager`) pointing at AWS Secrets
Manager via IAM access-key credentials, plus a `ClusterGenerator` for random
passwords. This works today; the question is whether to keep it, replace it,
or change how it's backed.

---

## 1. Continue with AWS Secrets Manager (current)

**What it is**: a managed, regional secret store; ESO's `aws` provider talks to
it over the API using an IAM principal (access key or IRSA).

**Pricing** (AWS Secrets Manager pricing page, aws.amazon.com/secrets-manager/pricing):
- **$0.40 per secret per month** (a replica secret counts as a distinct
  secret and is billed separately).
- **$0.05 per 10,000 API calls.**
- No perpetual free tier for the service itself. Per the official FAQ
  (aws.amazon.com/secrets-manager/faqs, "Is there a free tier?"): *"Starting
  July 15, 2025, new AWS customers will receive up to $200 in AWS Free Tier
  credits... The free plan will be available for 6 months after account
  creation."* This is a one-time, account-wide credit — not specific to
  Secrets Manager and not renewable. Catalyst's AWS account is already past
  any such window, so today's usage is billed in full ($0.40/secret/month +
  API calls).

**Unlock-on-boot / HA**: none of catalyst's concern — it's a regional managed
service with AWS-side HA/durability guarantees; there is no local unseal step
and nothing to operate.

**Maintenance burden for a single operator**: effectively zero day-2 ops
(no upgrades, no HA topology to manage). The operational cost is entirely
external: an AWS account, an IAM user/role with least-privilege access to
Secrets Manager, and awareness of per-secret monthly billing. Today's IAM
access-key-in-a-Secret model (`AWS_SM_CREDENTIALS_SECRET`) is also a
standing long-lived credential that must be rotated manually; IRSA (IAM
Roles for Service Accounts) would remove that if the cluster is ever
federated with AWS OIDC, but catalyst's k3s cluster is not on AWS and has no
OIDC provider registered with AWS, so long-lived keys are the practical
option here.

**Verdict**: cheap in absolute terms (a few dollars a month at catalyst's
scale) and by far the lowest-maintenance option, but it is a recurring cloud
bill with no free tier, and it ties the homelab's secret store to a
third-party account outside the cluster.

---

## 2. Self-hosted HashiCorp Vault

**What it is**: a secrets engine/PKI/encryption-as-a-service server. ESO has a
first-party `hashicorp-vault` provider (external-secrets.io/latest/provider/hashicorp-vault).

**License**: Vault ≥1.15 (via HashiCorp, now owned by IBM after the 2025
acquisition) is licensed under the **Business Source License (BSL)**, not
open source. Per the LICENSE file in `hashicorp/vault` on GitHub: *"Licensor:
International Business Machines Corporation (IBM)... Additional Use Grant:
You may make production use of the Licensed Work, provided Your use does not
include offering the Licensed Work to third parties on a hosted or embedded
basis in order to compete with IBM Corp's paid version(s)..."* Self-hosted,
non-competing production use (i.e., catalyst's homelab case) is explicitly
permitted by this grant, but the project is no longer OSI open source, and the
license terms are IBM's to change again on future versions.

**Unseal / HA** (developer.hashicorp.com/vault/docs/concepts/seal,
.../docs/concepts/ha, .../docs/configuration/storage/raft):
- Vault starts **sealed** on every boot/restart; it can reach storage but
  cannot decrypt anything until unsealed. Default is a **Shamir's Secret
  Sharing** seal: the root key is split into N shares, and a threshold of
  shares must be supplied via `vault operator unseal` (or the API) after
  *every* process restart. Per the docs, once unsealed a node stays unsealed
  until it's resealed, restarted, or the storage backend hits an
  unrecoverable error — i.e., **every reboot requires a manual unseal** unless
  auto-unseal is configured.
- **Auto-unseal** delegates the root-key protection to an external
  KMS/HSM/transit mechanism so the node can unseal itself at boot without an
  operator present. Per `docs/configuration/seal`, the built-in (non-Enterprise)
  auto-unseal mechanisms are cloud KMS integrations (AWS KMS, Azure Key Vault,
  GCP Cloud KMS, AliCloud KMS, OCI KMS) and the **Transit** seal (using a
  second, already-unsealed Vault as the unseal authority). **PKCS#11 (local
  HSM) auto-unseal is Enterprise-only** in Vault OSS's docs sidebar. For a
  homelab with no cloud KMS and no second Vault cluster to spare, this leaves
  either manual unseal after every reboot, or paying for a tiny cloud KMS key
  (e.g. AWS KMS, ~$1/month) purely to auto-unseal a self-hosted Vault — which
  re-introduces a cloud dependency for the "self-hosted" option.
- **HA / storage**: HashiCorp recommends **Integrated Storage (Raft)** as the
  default HA backend (`docs/configuration/storage/raft`): all nodes hold a
  full replicated copy of the data via the Raft consensus algorithm, with one
  active (leader) node and standbys that forward requests. This needs an odd
  number of nodes (typically 3) for quorum — a real ask for a homelab that may
  only have 1–2 k3s nodes. A single-node Vault has no HA and is a single
  point of failure by design (`docs/concepts/ha`).

**Maintenance burden for a single operator**: real and ongoing — running the
server, applying upgrades, managing TLS certs for cluster communication,
handling the unseal step (or building/maintaining an auto-unseal path),
backing up Raft snapshots, and — if HA is desired — running and babysitting
3 nodes' worth of storage and networking. This is the highest-maintenance
option surveyed.

**Verdict**: powerful and free-to-self-host (per the BSL grant), but the
unseal-on-boot story is the crux: Shamir means manual intervention on every
reboot, and the free auto-unseal paths either need a second Vault or a paid
cloud KMS. Real ops burden for a single operator, and the BSL license means
its ongoing licensing terms sit with IBM, not a community.

---

## 3. OpenBao (Vault's open-source fork)

**What it is**: a hard fork of Vault created after HashiCorp's 2023 BSL
relicensing, now a Linux Foundation-hosted (OpenSSF-sponsored) project. Per
the project README (`github.com/openbao/openbao`, raw README.md):
*"OpenBao is a software solution to manage, store, and distribute sensitive
data including secrets, certificates, and keys. The OpenBao community intends
to provide this software under an OSI-approved open-source license, led by a
community run under open-governance principles."* Its LICENSE file confirms
**Mozilla Public License 2.0** — a genuine OSI open-source license, unlike
Vault's BSL.

**API/architecture compatibility**: OpenBao is a drop-in-flavored fork — its
own docs (`openbao.org/docs/concepts/seal/`) restate the identical seal/root
key/Shamir model as Vault almost verbatim ("When an OpenBao server is
started, it starts in a sealed state... Unsealing is the process of
obtaining the plaintext root key..."). ESO lists **OpenBao as its own
first-party provider** (external-secrets.io provider list includes "OpenBao"
alongside "HashiCorp Vault"), so integration effort is equivalent to Vault's.

**Unseal / HA — the key differentiator**: OpenBao's seal configuration docs
(`openbao.org/docs/configuration/seal/`) list the same cloud KMS options as
Vault, **plus two mechanisms not gated behind an Enterprise tier**:
- **PKCS#11 Unseal** — local HSM support, listed as a plain (non-ENT) seal
  type in OpenBao's OSS docs, in contrast to Vault where PKCS11 is
  Enterprise-only.
- **Static Key seal** (`openbao.org/docs/configuration/seal/static/`) — a
  built-in mechanism requiring no external KMS at all: *"The static key seal
  configures OpenBao to use static keys provided alongside the configuration
  file as the Auto Unseal mechanism... provided directly, in base64 or hex
  form, as an environment variable... or as a file."* The docs explicitly
  warn this is only as strong as the trust of wherever that key file lives
  (e.g., a mounted Kubernetes Secret), but for a homelab this is a
  **genuinely free, no-cloud, auto-unseal-on-boot path** that Vault OSS does
  not offer.
- Integrated Storage (Raft) HA works the same way as Vault (same underlying
  design), with the same 3-node quorum consideration for true HA.

**Maintenance burden for a single operator**: same day-2 operational surface
as Vault (upgrades, TLS, backups), but the Static Key seal removes the worst
part of Vault's story for a solo operator — no more manual `vault operator
unseal` after every reboot, and no need to pay for or depend on a cloud KMS.
Single-node (no real HA) is still the realistic homelab topology, accepting a
Vault-style single point of failure if the one node is down.

**Verdict**: functionally a free, genuinely open-source Vault with a materially
better unattended-boot story for a single-node homelab deployment (Static Key
seal), at the same operational cost as Vault otherwise. If self-hosting a
Vault-family product, OpenBao is the more defensible choice over Vault itself
given the license and the auto-unseal gap.

---

## 4. Other viable options

### 4.1 Bitwarden Secrets Manager (hosted, has a real free tier)

Per Bitwarden's own product/pricing page (bitwarden.com/products/secrets-manager):
the **Free** plan includes **unlimited secret storage**, **up to 3 machine
accounts**, and **up to 3 projects** at no cost (paid tiers scale machine
accounts and users, $1/extra machine account on Teams). ESO has a first-party
`bitwardensecretsmanager` provider (external-secrets.io provider docs), which
requires running an additional **Bitwarden SDK Server** component alongside
ESO (the ESO Helm chart packages it as an optional subchart,
`--set bitwarden-sdk-server.enabled=true`) and terminating it with a
cert-manager-issued TLS certificate, since the SDK server must be served over
HTTPS.

- **Maintenance**: low — one extra in-cluster deployment (the SDK server) and
  a cert, no unseal step, no HA topology to run (Bitwarden's cloud hosts
  availability).
- **Constraint**: catalyst's current design uses one shared `ClusterSecretStore`
  credential; 3 machine accounts is enough for that pattern (e.g., one for
  ESO, headroom for CI or a second use), but would need care if the machine
  account model doesn't map 1:1 to how ESO authenticates.
- **Cost**: $0 at homelab scale.

### 4.2 1Password (hosted, has a Secrets Automation free allowance for small teams)

ESO lists both a "1Password Connect Server" and "1Password SDK" provider.
1Password's model requires either self-hosting a Connect server (an
additional in-cluster component, similar operational shape to the Bitwarden
SDK server) or using its hosted Service Accounts/SDK. Viable, but was not
pursued further in this pass — Bitwarden's free tier is simpler and already
well documented above; 1Password's is a reasonable fallback with a similar
component-hosting cost, not evaluated in depth here since it does not appear
to change the overall calculus.

### 4.3 SOPS (+ age) — git-native, no server to run

Per the SOPS repository (`github.com/getsops/sops`, README.rst): *"SOPS is an
editor of encrypted files that supports YAML, JSON, ENV, INI and BINARY
formats and encrypts with AWS KMS, GCP KMS, Azure Key Vault, HuaweiCloud KMS,
age, and PGP."* Originally a Mozilla project, donated to the **CNCF as a
Sandbox project in 2023**, MPL-2.0 licensed.

Paired with **age** (a modern, simple asymmetric encryption tool, not an AWS
service), this lets secret values be encrypted in place and committed
directly to the catalyst git repo as ciphertext, decrypted only where needed
(e.g., inside the CMP render step, or a CI step) using an age private key
held outside git.

- **Unlock-on-boot/HA**: not applicable in the Vault sense — there's no
  server or seal state. Availability is just "the age key exists somewhere
  the render step can read it" (e.g., a k8s Secret mounted into the CMP
  sidecar).
- **Maintenance**: very low — no service to run, upgrade, or back up beyond
  the age keypair itself. The real cost is **integration work**: catalyst's
  render pipeline (`main.ts`/CMP) would need to shell out to `sops -d` (or an
  equivalent library) at render time, and catalyst's current dynamic-secret
  generation pattern (`ClusterGenerator`/`Password`, used for auto-generated
  DB/app passwords) has **no direct SOPS equivalent** — SOPS only encrypts
  values you already have; it doesn't generate or rotate them. It would
  cover static secrets well but not replace ESO's generator functionality.
- **Cost**: $0.

### 4.4 Infisical (open-source, self-hostable or hosted, real free tier)

Per Infisical's pricing page (infisical.com/pricing), the **Free** plan
includes **5 identities** and **unlimited projects** at $0. Per the project's
LICENSE on GitHub (`github.com/Infisical/infisical`): the core is open source,
with enterprise-only code carved out under a separate `ee/LICENSE` — i.e., it
is genuinely self-hostable without a subscription for core functionality.
ESO's provider list includes "Infisical" as a first-party provider.

- **Maintenance**: if self-hosted, comparable to running any other stateful
  service (a Postgres-backed app) — lower than Vault/OpenBao (no unseal
  concept), higher than using it hosted. If using Infisical's hosted free
  tier instead, maintenance drops to ~zero, same shape as Bitwarden's option.
- **Cost**: $0 either way at this scale.

### 4.5 Doppler (hosted, free tier is seat-based)

Per Doppler's pricing page (doppler.com/pricing), the **Developer** plan is
**free for 3 users**, includes the Doppler CLI, service tokens, and 5 config
syncs. Doppler is not in ESO's terraform/kubernetes-native provider list in
the same first-class way as the others surveyed (no Doppler entry appears
in the ESO provider sidebar the others were checked against — actually
"Doppler" *is* listed under providers alongside Keeper/Passbolt/etc.).
Doppler's free tier is scoped to human users rather than secrets or machine
accounts, which fits a single-operator homelab fine, but it's a less
frequently referenced ESO integration than AWS/Vault/Bitwarden.

### 4.6 Bitnami Sealed Secrets (in-cluster, no external dependency at all)

Per the project README (`github.com/bitnami-labs/sealed-secrets`): *"Encrypt
your Secret into a SealedSecret, which is safe to store - even inside a
public repository. The SealedSecret can be decrypted only by the controller
running in the target cluster."* This is the simplest possible
"no external service, no cloud account" option: one in-cluster controller,
asymmetric encryption, ciphertext committed to git.

- **Unlock-on-boot/HA**: no seal/unseal step at all — the controller just
  needs its private key (persisted as a k8s Secret) present when it starts.
  That private key is itself a single point of failure: if it's lost (e.g.,
  cluster rebuilt without backing it up) every previously-sealed secret is
  unrecoverable and must be re-sealed from source values.
- **Maintenance**: lowest of any "real" secret-storage option — a single
  controller pod, no HA topology, no cloud account.
- **Fit for catalyst**: same gap as SOPS — no dynamic secret generation
  (Sealed Secrets only wraps values you already have), so it would not
  directly replace the `ClusterGenerator`/`Password` pattern currently used
  for auto-generated credentials.

---

## Summary comparison

| Option | $/mo at catalyst scale | Unlock-on-boot story | HA story | Solo-operator maintenance |
|---|---|---|---|---|
| AWS Secrets Manager (current) | ~few $ (no free tier) | N/A (managed) | AWS-managed | Lowest — no server to run |
| HashiCorp Vault (self-hosted) | $0 (BSL grant covers this use) or ~$1 (cloud KMS auto-unseal) | Manual Shamir unseal on every reboot unless paying for cloud KMS/second Vault | Raft, needs 3 nodes for real HA | Highest — server, TLS, backups, unseal ops |
| OpenBao (self-hosted) | $0 | Static Key seal = free, no-cloud auto-unseal | Same Raft/3-node caveat as Vault | High but better than Vault (no forced manual unseal) |
| Bitwarden Secrets Manager | $0 (free tier: unlimited secrets, 3 machine accounts, 3 projects) | N/A (hosted) + one extra in-cluster SDK server pod | Bitwarden-managed | Low — one extra pod + cert |
| Infisical | $0 (free tier: 5 identities) hosted, or self-host for $0 (core OSS) | N/A if hosted; normal stateful-app ops if self-hosted | Vendor-managed or self-run | Low (hosted) / Medium (self-hosted) |
| SOPS + age | $0 | N/A — no server | N/A | Low ops, but real integration work; no dynamic-secret generation |
| Sealed Secrets | $0 | N/A — controller just needs its key | N/A (single controller = SPOF for the key) | Lowest; same no-generation gap as SOPS |
| Doppler | $0 (3 users) | N/A (hosted) | Vendor-managed | Low |

## Recommendation

For a single operator who already has this working with AWS Secrets Manager,
the strongest **replace** cases are:

- **Bitwarden Secrets Manager**, if the goal is to drop the recurring AWS
  bill and get a real ($0) free tier while keeping a fully-managed,
  no-unseal, low-maintenance model — it's the closest like-for-like swap for
  the current ESO `ClusterSecretStore` pattern, at the cost of running one
  extra in-cluster component (the Bitwarden SDK server) and a TLS cert.
- **OpenBao**, if the goal is to bring secrets fully in-house / offline-capable
  with zero recurring cost and accept meaningfully more ops burden — its
  Static Key seal specifically fixes the "manual unseal on every reboot"
  problem that makes plain Vault a poor fit for an unattended single-node
  homelab, and it does so under a real open-source license (MPL-2.0) rather
  than Vault's IBM-owned BSL.

**Do not self-host plain HashiCorp Vault** for this use case: the free
auto-unseal paths either require a second Vault (impractical for a homelab)
or a paid cloud KMS (which just re-introduces a recurring cloud cost while
adding Vault's operational burden on top) — OpenBao removes that trade-off
outright via Static Key auto-unseal.

**SOPS+age and Sealed Secrets** are worth keeping in mind as a complementary,
not competing, layer — they're excellent for "encrypt this value into git"
but don't replace ESO's dynamic secret **generation** (the `ClusterGenerator`/
`Password` pattern catalyst already relies on for auto-generated app/DB
passwords), so adopting either would still need a generator story alongside
it.

This research does not make the final call between "keep AWS SM" and
"migrate to Bitwarden/OpenBao" — that tradeoff (cost vs. self-hosting
complexity vs. an extra in-cluster dependency) is a judgment call for a
follow-up decision ticket, not a fact this research can settle.

## Sources

- AWS Secrets Manager pricing: https://aws.amazon.com/secrets-manager/pricing/
- AWS Secrets Manager FAQs (free tier): https://aws.amazon.com/secrets-manager/faqs/
- HashiCorp Vault — Seal/Unseal concepts: https://developer.hashicorp.com/vault/docs/concepts/seal
- HashiCorp Vault — High Availability concepts: https://developer.hashicorp.com/vault/docs/concepts/ha
- HashiCorp Vault — Integrated Storage (Raft): https://developer.hashicorp.com/vault/docs/configuration/storage/raft
- HashiCorp Vault — seal configuration (auto-unseal mechanisms): https://developer.hashicorp.com/vault/docs/configuration/seal
- HashiCorp Vault LICENSE (BSL, IBM): https://raw.githubusercontent.com/hashicorp/vault/main/LICENSE
- OpenBao README: https://raw.githubusercontent.com/openbao/openbao/main/README.md
- OpenBao LICENSE (MPL-2.0): https://raw.githubusercontent.com/openbao/openbao/main/LICENSE
- OpenBao — Seal/Unseal concepts: https://openbao.org/docs/concepts/seal/
- OpenBao — seal configuration (incl. PKCS#11, Static Key): https://openbao.org/docs/configuration/seal/
- OpenBao — Static Key seal: https://openbao.org/docs/configuration/seal/static/
- External Secrets Operator — provider list: https://external-secrets.io/latest/
- External Secrets Operator — Bitwarden Secrets Manager provider: https://external-secrets.io/latest/provider/bitwarden-secrets-manager/
- Bitwarden Secrets Manager product/pricing: https://bitwarden.com/products/secrets-manager/
- SOPS README: https://raw.githubusercontent.com/getsops/sops/main/README.rst
- Infisical pricing: https://infisical.com/pricing
- Infisical LICENSE: https://raw.githubusercontent.com/Infisical/infisical/main/LICENSE
- Doppler pricing: https://www.doppler.com/pricing
- Bitnami Sealed Secrets README: https://raw.githubusercontent.com/bitnami-labs/sealed-secrets/main/README.md
- Catalyst current implementation: `apps/external-secrets.ts` (this repo)
