# Research: recurring cloud-cost rollup across every chosen managed service

**Ticket**: [#63](https://github.com/aaronkyriesenbach/catalyst/issues/63) — part of the ["Homelab
platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: every ADR in `docs/adr/` (0001–0019) was read in full, plus the map itself (#1), to
enumerate every third-party/cloud/managed service this design has actually committed to. For each,
this document cites that service's own current, official pricing/licensing page, states the
free-tier limits (if any), checks whether this repo's actual usage pattern (single operator,
homelab scale) stays inside them, and gives the recurring dollar cost. **No judgment is made on
whether the total is acceptable** — that call belongs to the ticket owner.

All prices below were fetched directly from each vendor's own pricing/docs page (or, where a page
renders client-side, the vendor's own pricing data embedded in that page's own JS/JSON) on the date
this research was performed. Where a figure could not be independently re-confirmed from a
non-JS-rendered primary source in this session, that is flagged explicitly rather than presented as
fact.

---

## TL;DR

- **Every service this design newly introduces that has a real, non-zero recurring dollar cost is
  AWS-billed, and the total is small**: AWS Secrets Manager for bootstrap-layer secrets (≈$2.40–2.50/mo
  for ~6 secrets) plus negligible OpenTofu-state S3 storage/request costs (≈$0.01/mo) and negligible
  SES alert-email costs (≈$0.02/mo at homelab volume) — **≈$2.5/month total** for the items this
  research could size precisely from the ADRs.
- **Cloudflare's entire Tunnel + Access + DNS setup for `lab53.net` (ADR 0016/0017) stays on
  Cloudflare's free tier, confirmed against Cloudflare's own plans page and docs**: DNS hosting is a
  Free-plan feature, Zero Trust (Tunnel + Access) is free for "teams under 50 users" (this repo needs
  exactly 1), and Cloudflare Tunnel's own account limits (1,000 tunnels, 1,000 routes) are far above
  this repo's 3-tunnel/handful-of-hostnames need. **One real, non-hypothetical catch found**:
  Cloudflare's own Service-Specific Terms require a *paid* product (Stream/Images/Developer
  Platform) to serve video or "a disproportionate percentage of ... other large files" through its
  CDN on Free/Pro/Business plans — and this repo's app catalog includes exactly that kind of app
  (Jellyfin-style media, Immich's photo/video library) if any of them end up externally reachable
  through the Cloudflare Tunnel.
- **Backblaze B2's actual monthly cost cannot be computed from any ADR** — the map itself flags B2 as
  "of unconfirmed sufficiency" and lists backup/DR as a "not yet specified" area; no ADR states how
  many GB TrueNAS actually replicates there. Backblaze's own pricing page gives the rate structure
  (first 10GB free, then $6.95/TB/30-days, egress free up to 3x average monthly storage, $0.01/GB
  overage) so the number is pluggable once the real dataset size is known, but it is **not** included
  in this document's hard total.
- **Every self-hosted platform component this design's ADRs claim is "free" checks out against its
  own license, with one important exception.** ArgoCD, Zot, SPIRE, OpenBao, CloudNativePG, Istio, and
  VictoriaMetrics's OSS single-node components (`VMSingle`/`VLSingle`/`VTSingle`, used here — not the
  Enterprise-licensed cluster features) are all confirmed Apache-2.0 or MPL-2.0 with no license fee.
  **Sidero Omni is the exception worth flagging explicitly**: Omni is licensed under the Business
  Source License 1.1, not a permissive OSS license. Self-hosting it is free *only* under its
  Additional Use Grant's carve-out for "personal use in a home lab environment" — the exact
  description this repo's own map gives itself ("single operator... homelab"). The moment this
  platform's Omni instance is relied on for anything the operator's own livelihood/business depends
  on, Sidero's own guidance says a commercial license (self-hosted subscription, or their hosted SaaS
  starting at $10/month for up to 10 nodes) is required — there is explicitly no free production tier
  at any size.
- **Renovate's hosted GitHub App (map decision #28) is confirmed free** — Mend's own docs describe
  "Mend Renovate Community Cloud (Free)... available for all across an unlimited number of public and
  private repositories," which is the tier a single-repo homelab setup uses.
- **Route 53 Domains registration for `lab53.net` is a pre-existing, unchanged cost** (ADR 0016:
  "the domain stays registered through Route 53 Domains; only the nameserver delegation moves") —
  this design doesn't newly introduce it, and its exact current per-year rate for a `.net` TLD could
  not be scraped from a static fetch of AWS's own pricing page in this session (the table is
  client-rendered from a data source this session's tooling couldn't reach); it is flagged, not
  fabricated, and excluded from the hard total below.

---

## 1. AWS Secrets Manager (bootstrap-layer secrets)

**Source**: [AWS Secrets Manager pricing](https://aws.amazon.com/secrets-manager/pricing/) — pricing
data embedded directly in that page confirms, for every US region:

- **$0.40 per secret per month** (a replica secret counts as a distinct secret, billed the same way;
  prorated hourly for partial months).
- **$0.05 per 10,000 API calls** ($0.000005/call).
- No ongoing free tier beyond a time-limited new-account credit (up to $200 in Free Tier credits for
  new AWS customers, available as a 6-month free-plan option — not a permanent per-secret allowance).

**This repo's usage** (ADR 0001, 0004, 0011, 0018 — bootstrap-layer secrets only; app-layer secrets
moved to self-hosted OpenBao per ADR 0004): at minimum 6 distinct secrets are named across the ADRs —
Proxmox API token, Unifi controller credentials, TrueNAS SSH key (ADR 0001), Omni's bootstrap admin
password (ADR 0011), the `Operator`-scoped Omni service-account key for the cluster-registration
CronJob (ADR 0011), and OpenBao's seeded `superuser` admin password (ADR 0018) — all explicitly AWS
SM because they sit at or below the Kubernetes-cluster-existence boundary ADR 0001 draws, not
app-layer. (The exact number is an implementation detail — some of these could be combined into
fewer secret objects — so this is a lower bound.)

- **Storage**: 6 secrets × $0.40/month = **$2.40/month**.
- **API calls**: these are read rarely (bootstrap-time `tofu apply`, plus ESO's periodic
  `ClusterSecretStore` refresh for the handful still synced into a cluster — typically hourly). At
  ~6 secrets refreshed hourly, that's ~4,320 calls/month → $0.05 × 0.432 ≈ **$0.02/month**.
- **Total: ≈$2.42/month.** (ADR 0004 itself already concedes this isn't a cost decision: "AWS SM's
  ~$2–5/month is negligible" — this research's own count lands inside that stated range.)

## 2. OpenTofu state in S3 (ADR 0001)

**Source**: [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/) — confirmed via AWS's own public
Price List API data backing that page (US East, N. Virginia, S3 Standard):

- **Storage**: $0.023/GB-month for the first 50TB/month.
- **Requests**: $0.005 per 1,000 PUT/COPY/POST/LIST requests ($0.000005/request); $0.0004 per 1,000
  GET and other requests ($0.0000004/request).
- No ongoing free tier for an established account beyond the same time-limited new-customer credit
  noted above.

**This repo's usage**: OpenTofu state for the bootstrap layer (Proxmox/TrueNAS/Unifi resources) is a
tiny JSON file — realistically well under a few MB even with state-file bloat. At 1MB:
$0.023/GB-month × 0.001GB ≈ **$0.000023/month** — effectively zero. Request volume is bounded by how
often `tofu plan`/`apply` runs (a human-triggered, infrequent action for a homelab, not a CI loop) —
even at a generous 200 requests/month (reads on every plan/apply, states with locking, etc.), cost is
a fraction of a cent. **Total: effectively $0.00–$0.01/month.**

## 3. Backblaze B2 (existing TrueNAS replication target)

**Source**: [Backblaze B2 Cloud Storage pricing](https://www.backblaze.com/cloud-storage/pricing) —
the page's own embedded pricing constants and FAQ prose both confirm:

- **Storage**: "billed monthly, based on the amount of data stored per byte-hour over the last month
  at a rate of **$6.95/TB/30-days**" (= $0.00695/GB-month) for standard (non-"Overdrive") B2 Cloud
  Storage, pay-as-you-go.
- **First 10GB of storage is always free.**
- **Egress**: free up to 3x your average monthly storage (also free indefinitely through partner
  CDNs/compute providers, e.g. Cloudflare — not relevant here since this is a NAS→B2 replication job,
  not a CDN-fronted read path); overage beyond the 3x allowance is **$0.01/GB**.
- **API calls**: Class A/B/C calls (the ones a replication job predominantly uses — uploads, listing,
  downloads) are free for pay-as-you-go customers; Class D (some transactional calls) cost
  $0.004/10,000 calls with the first 2,500/day free.

**This repo's usage**: the map itself describes this as "TrueNAS also runs a separate replication job
to Backblaze B2 of **unconfirmed sufficiency**," and lists the whole backup/DR strategy as
"**not yet specified**" — no ADR states how many GB of NAS data this job actually replicates.
**This document cannot compute a dollar total for this line item** without that number; it is
deliberately left as a rate, not a total, consistent with the ticket's instruction to report current
pricing regardless of whether the underlying question (sufficiency) is resolved. To size it
yourself: `(stored_GB − 10) × $0.00695`, plus `$0.01 × max(0, monthly_egress_GB − 3 × avg_stored_GB)`
if a restore/egress-heavy event happens in a given month.

## 4. Cloudflare (Tunnel + Access + `lab53.net` DNS)

**Sources**: [Cloudflare plans page](https://www.cloudflare.com/plans/) (embedded pricing data),
Cloudflare's own [Zero Trust seat-management
docs](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/),
[Cloudflare One account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/),
[Cloudflare Tunnel FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/),
and Cloudflare's [Service-Specific
Terms](https://www.cloudflare.com/service-specific-terms-application-services/).

- **DNS hosting**: Cloudflare's own plans page lists "Fast, Easy-to-use DNS" as a feature of the
  **Free** plan ($0/month) — confirming ADR 0016's full-NS-delegation choice (as opposed to the
  rejected Partial/CNAME Setup, gated to Business/Enterprise at ~$200–250/mo per that ADR, also
  independently confirmed by [Research #53](https://github.com/aaronkyriesenbach/catalyst/blob/research/cloudflare-tunnel-dns-research/docs/research/cloudflare-tunnel-dns-research.md))
  is free.
- **Zero Trust (Tunnel + Access)**: Cloudflare's own plans page: "Free — Teams under 50 users or
  enterprise proof-of-concept tests. **$0 forever**... User Limit: 50 users." ADR 0017 needs exactly
  **one** authenticated operator across 3 per-cluster Tunnel objects — nowhere near the 50-seat cap.
  Seats are consumed by *authenticated users*, not by the number of Tunnel objects, hostnames, or
  Access applications, per Cloudflare's own seat-management docs — so running 3 separate Tunnels
  (ADR 0017) does not multiply the seat count.
- **Cloudflare Tunnel's own account limits** (from Cloudflare's own docs, not a pricing page but
  confirms no metered/paid ceiling applies at this scale): 1,000 `cloudflared` tunnels per account,
  1,000 combined CIDR+hostname routes per account, 25 active replicas per tunnel — this repo's 3
  tunnels and modest per-app hostname count are far inside every limit.
- **Total: $0/month**, provided usage stays as described.

**What would force a paid tier** (explicitly checked, per the ticket's instruction to flag this):

- **Exceeding 50 active Zero Trust users** — not a risk for a stated single-operator design. Adding a
  handful of family members/guests as Access users would still stay under the cap; Access **service
  tokens** (machine-to-machine, not human logins) don't consume a seat at all per Cloudflare's docs,
  so any future automation reaching an Access-gated app also doesn't push toward the limit.
- **Partial (CNAME) Setup DNS** — already rejected by ADR 0016 specifically because it's
  Business/Enterprise-plan-gated (~$200–250/mo, confirmed by that ADR against Cloudflare's own docs).
  Full NS delegation (what's actually adopted) avoids this entirely.
- **Serving video or "a disproportionate percentage of ... other large files" through Cloudflare's
  CDN on Free/Pro/Business plans without a specific paid product** (Stream, Images, or the Developer
  Platform) — this is a real clause in Cloudflare's own Service-Specific Terms, not a hypothetical:
  *"Unless you are an Enterprise customer, Cloudflare offers specific Paid Services (e.g., the
  Developer Platform, Images, and Stream) that you must use in order to serve video and other large
  files via the CDN. Cloudflare reserves the right to disable or limit your access to or use of the
  CDN... if you use or are suspected of using the CDN without such Paid Services to serve video or a
  disproportionate percentage of pictures, audio files, or other large files."* Cloudflare Tunnel's
  public-hostname routing runs through the same edge/CDN layer (a Tunnel-routed hostname has no
  "DNS-only, unproxied" mode — the `cfargotunnel.com` CNAME target only resolves through Cloudflare's
  proxying). This repo's existing app catalog includes exactly this class of app (a Jellyfin-style
  media server, Immich's photo/video library) — **if any such app is ever routed externally through
  the Cloudflare Tunnel (ADR 0017) rather than staying LAN/internal-only, this clause is a real,
  named risk**, not a theoretical one, though Cloudflare's own wording ("disproportionate percentage,"
  reserved right to act, "reasonable efforts" to notify first) suggests this is enforced against
  abuse patterns rather than a hard automatic cutoff at a fixed byte count.

## 5. Route 53 Domains (registration only — pre-existing, unchanged)

**Source**: [Amazon Route 53 pricing](https://aws.amazon.com/route53/pricing/).

ADR 0016 is explicit that this stays unchanged: *"the domain stays registered through Route 53
Domains; only the nameserver delegation moves"* — this is a pre-existing cost this design doesn't
newly introduce (the *DNS hosting* moves to Cloudflare per §4 above; *registration* does not). AWS's
own Route 53 pricing page renders its per-TLD domain-registration table entirely client-side from a
data source this session's static-fetch tooling could not reach (unlike the Secrets Manager and S3
pricing pages, whose underlying pricing data is embedded in the page and was directly confirmed
above) — so **this document does not state a specific current `.net` renewal figure as confirmed
fact**. Route 53 Domains' publicly known list-price history for `.net` registrations/renewals has
been in the low-teens-of-dollars-per-year range; check
[the live pricing page](https://aws.amazon.com/route53/pricing/#Domain_Name_Registration) or the
Route 53 console directly for the exact current rate rather than relying on this document for that
one number. This is excluded from the hard total below for that reason.

## 6. Sidero Omni (self-hosted cluster-lifecycle management plane)

**Sources**: Sidero Labs' own [Production vs. Non-Production Use Under the Business Source
License](https://docs.siderolabs.com/omni/self-hosted/production-vs-non-production.md) guidance, and
[siderolabs.com/pricing](https://www.siderolabs.com/pricing) (hosted-SaaS pricing, for contrast).

ADRs 0007 (via issue #7), 0011, 0012, 0014, and 0018 all build on **self-hosted** Omni, treating it
as a $0 infrastructure choice. That's correct for this repo's stated context, but the reason why is a
license carve-out worth stating explicitly, not an unconditional "self-hosted = free":

- Omni is distributed under the **Business Source License 1.1**, not a permissive OSS license.
  Sidero's own guidance: *"The license lets anyone read, modify, and build on Omni freely, and run it
  for non-production use at no charge. Production use requires a commercial license."*
- The Additional Use Grant's free carve-out explicitly includes **"personal use in a home lab
  environment"** — matching this repo's own map, which states its standing context as
  "single-operator" and describes this whole effort as a "homelab platform rearchitecture."
- Sidero's own guidance is unusually blunt that there is **no free tier at any scale once usage
  becomes "production"**: *"there is no node count or usage level small enough to stay free once a
  deployment qualifies as production, and there is no free production tier regardless of size."*
  Their own worked example (1,000 production nodes + 600 staging nodes) states *both* fleets require
  a commercial license — the "just staging"/"just testing" framing does not exempt a standing,
  relied-upon deployment.
- **If this changes** (e.g., this cluster starts hosting something the operator's income or other
  people's access depends on, moving it out of "personal, non-commercial... home lab" territory),
  Sidero's own hosted-SaaS pricing (for contrast, not what's adopted here) starts at **Omni · Hobby:
  $10/month for up to 10 nodes, 2 users**, scaling to **Omni · Startup: $25/node/month** for larger
  fleets — or a self-hosted commercial subscription, priced on contact.
- **Talos Linux itself** (the OS every node runs, per issue #7) is confirmed separately and
  unconditionally free: Sidero's own pricing page: *"Talos Linux, free and open source (MPL-2.0)...
  $0 forever... Unlimited clusters & nodes."* Only **Talos Enterprise Linux** (a separate commercial
  tier: compliance/FIPS builds, CVE SLAs, 24/7 support, $1,000/node/year, 10-node minimum) costs
  money — not adopted or implied by any ADR here.

**Total under the described usage: $0/month** — but flagged, per the ticket's instruction, as
conditional on staying within the BSL's home-lab/non-production grant, not an unconditional "OSS,
therefore free" like the rest of this platform's self-hosted components.

## 7. Renovate — hosted GitHub App (map decision, issue #28)

**Source**: [Renovate's own Mend-hosted Apps
docs](https://docs.renovatebot.com/mend-hosted/overview/).

Confirmed directly: *"Mend Renovate Community Cloud (Free) — A generous free tier, available for all
across an unlimited number of public and private repositories."* This repo's actual usage (one
repository, notify-only via the Dependency Dashboard, per the map's decision) needs nothing beyond
this tier: 1 concurrent job per org, jobs scheduled every 4 hours on active repos, 1 vCPU/3GB
RAM/15GB disk per job, 30-minute job timeout — all far above what a single-repo homelab setup
exercises. **Total: $0/month.**

## 8. Self-hosted platform components — license/cost verification

ADR 0004, 0006, 0007 (via #21/#36), 0008, 0014, and the registry decision (#17) all state or imply
these run self-hosted at no license cost. Verified directly against each project's own repository
license file / official docs:

| Component | ADR | License (verified at source) | Cost |
|---|---|---|---|
| ArgoCD | 0007 | Apache-2.0 ([`argoproj/argo-cd` LICENSE](https://github.com/argoproj/argo-cd/blob/master/LICENSE)) | $0 |
| Zot (registry) | issue #17 | Apache-2.0 ([`project-zot/zot` LICENSE](https://github.com/project-zot/zot/blob/main/LICENSE)) | $0 |
| SPIRE | 0014 | Apache-2.0 ([`spiffe/spire` LICENSE](https://github.com/spiffe/spire/blob/main/LICENSE)) | $0 |
| OpenBao | 0004, 0018, 0019 | MPL-2.0 ([`openbao/openbao` LICENSE](https://github.com/openbao/openbao/blob/main/LICENSE)) | $0 |
| CloudNativePG | 0006 | Apache-2.0 ([`cloudnative-pg/cloudnative-pg` LICENSE](https://github.com/cloudnative-pg/cloudnative-pg/blob/main/LICENSE)) | $0 |
| Istio | 0009 | Apache-2.0 ([`istio/istio` LICENSE](https://github.com/istio/istio/blob/master/LICENSE)) | $0 |
| VictoriaMetrics/Logs/Traces (single-node OSS) | 0008 | Apache-2.0 core ([`VictoriaMetrics/VictoriaMetrics` LICENSE](https://github.com/VictoriaMetrics/VictoriaMetrics/blob/master/LICENSE)) | $0 |
| Talos Linux | issue #7 | MPL-2.0 ([Sidero's own pricing page](https://www.siderolabs.com/pricing)) | $0 |

**One nuance worth flagging on VictoriaMetrics specifically**, since ADR 0008 is careful to say
"single-node" throughout: VictoriaMetrics's own [Enterprise
docs](https://docs.victoriametrics.com/enterprise/) confirm Enterprise is a **separate, opt-in binary
build** (`*-enterprise.tar.gz`, requiring a `-license`/`-licenseFile` flag) that adds specific
features not used here — downsampling, multi-tenant `vmalert`, automatic `vmstorage` discovery,
mTLS between cluster components, anomaly detection, FIPS builds, etc. ADR 0008's chosen shape
(`VMSingle`/`VLSingle`/`VTSingle` via the standard `victoria-metrics-k8s-stack` chart, no cluster
mode) uses none of these — confirming there's no hidden Enterprise-tier dependency lurking in the
chosen configuration, consistent with the ADR's own claim.

## 9. AWS SES and Pushover (existing alerting path, referenced unchanged in ADR 0008)

ADR 0008 states the existing Apprise → Pushover (push) + AWS SES (email) alerting design "needs no
rework" under the new observability stack. Both carry real (if tiny) recurring-cost dimensions worth
confirming since they're named in an ADR:

- **AWS SES** — [Amazon SES pricing](https://aws.amazon.com/ses/pricing/): the current "Essentials"
  plan (0 accounts with no prior metered activity default to this) has **no monthly account fee** and
  charges **$0.16 per 1,000 emails** sent (0–10M/month tier). At homelab alert volumes (well under a
  few hundred notification emails/month), cost is a fraction of a cent to a couple of cents per month
  — e.g. 100 emails/month ≈ $0.016. **Total: ≈$0.00–$0.05/month.** (Pro/Enterprise SES plans do carry
  a flat monthly account fee — $105/$500/month respectively — but nothing in this design calls for
  those tiers.)
- **Pushover** — [pushover.net](https://pushover.net/): confirmed directly, "Pushover for Everyone"
  (individual, non-Teams use, which is what a single-operator homelab alerting setup is) is **"no
  subscription and just a simple one-time in-app purchase on each platform... after a 30-day free
  trial"** — not a recurring charge at all. (Pushover for Teams is a separate, subscription,
  per-user/month product for organizations — not applicable here.) **Total: $0/month recurring**
  (a historical one-time purchase, not part of this rollup's monthly figure).

## 10. AWS IAM (OIDC federation, ADR 0014)

ADR 0014 has SPIRE's OIDC Discovery Provider federate to an **AWS IAM OIDC Identity Provider** for
`external-dns`'s Route53 credentials. AWS IAM itself — including registering an OIDC identity
provider, roles, and policies — [carries no separate service charge](https://aws.amazon.com/iam/); it
is a feature of any AWS account, not a metered product. **Total: $0/month.**

---

## Total monthly recurring cost

Only line items this research could size precisely from what the ADRs actually specify are added
into the hard total. Line items that are real but genuinely unpriceable from the ADRs alone
(Backblaze B2's actual dollar cost — dataset size not specified anywhere; Route 53 `.net` domain
renewal — exact current rate not retrievable via static fetch in this session) are listed separately
and explicitly excluded, rather than estimated and presented as fact.

| Service | Monthly cost |
|---|---|
| AWS Secrets Manager (bootstrap-layer secrets) | ≈$2.42 |
| Amazon S3 (OpenTofu state) | ≈$0.01 |
| AWS SES (alert emails) | ≈$0.02 |
| Cloudflare (Tunnel + Access + DNS) | $0.00 |
| Sidero Omni (self-hosted, home-lab BSL grant) | $0.00 |
| Talos Linux | $0.00 |
| Renovate (Mend hosted GitHub App, Community Cloud) | $0.00 |
| ArgoCD, Zot, SPIRE, OpenBao, CloudNativePG, Istio, VictoriaMetrics stack (all self-hosted OSS) | $0.00 |
| Pushover (one-time purchase, not recurring) | $0.00 |
| AWS IAM (OIDC federation) | $0.00 |
| **Total (priceable items)** | **≈$2.45/month** |

**Explicitly excluded from the total above, not zero, just unpriceable from any ADR / this session's
tooling:**

- **Backblaze B2** — real, non-zero cost once TrueNAS's actual replicated data volume is known:
  `(stored_GB − 10) × $0.00695/month`, plus egress overage past the free 3x-average-storage
  allowance at $0.01/GB. No ADR states the dataset size.
- **Route 53 Domains `.net` registration/renewal for `lab53.net`** — a real, pre-existing annual
  cost, unchanged by this design (ADR 0016 keeps registration at Route 53 Domains); this session's
  static-fetch tooling could not retrieve AWS's current per-TLD table (client-side rendered) to state
  an exact confirmed figure — check
  [AWS's own Route 53 pricing page](https://aws.amazon.com/route53/pricing/#Domain_Name_Registration)
  directly for the current rate.
