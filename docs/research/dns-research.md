# Research: DNS management options, re-evaluated holistically

Ticket: [aaronkyriesenbach/catalyst#14](https://github.com/aaronkyriesenbach/catalyst/issues/14)
(child of wayfinder map #1; blocks decision ticket #15 "Decide DNS approach")

## Question

Re-evaluate DNS management holistically for the rearchitected platform — do not
assume the current split (`external-dns-int` targeting Unifi,
`external-dns-ext` targeting Route53) is the right shape. Research
alternatives and confirm/refute whether the current approach is the best fit.

## What's actually running today

Read directly from `apps/external-dns.ts` and its values files in the main
worktree (`aaronkyriesenbach/catalyst`, current `main`):

- **`external-dns-int`** — Helm chart `external-dns` v1.20.0 from the
  upstream repo (`https://kubernetes-sigs.github.io/external-dns/`), using
  `provider.name: webhook` with the community webhook image
  `ghcr.io/kashalls/external-dns-unifi-webhook:v0.8.2`, talking to the Unifi
  controller at `https://192.168.1.1`. Source is `gateway-httproute`,
  `domainFilters: ["lab53.net"]`, `policy: sync`, watching the
  `traefik-internal` Gateway. This writes records into the Unifi controller's
  own DNS (dnsmasq-backed).
- **`external-dns-ext`** — same chart/version, `provider.name: aws`
  (in-tree Route53 provider), `domainFilters: ["lab53.net"]` excluding
  `int.lab53.net`, `aws-zone-type: public`, watching the `traefik-external`
  Gateway, authenticated via a long-lived IAM user's access key/secret in
  `aws-credentials`.
- **`ddns-route53`** — a separate, unrelated component: a `crazymax/ddns-route53`
  cron-style deployment that updates one A record (`home.lab53.net`, zone
  `Z01889102EIVWW3UBDYVL`) every 5 minutes with the router's current public
  IP. This is dynamic-DNS-for-the-WAN-IP, not app-record management, and is
  out of `external-dns`'s scope entirely.

## Confirmed external fact: the zone is already on Route53

Live DNS lookup (not a config assumption) confirms `lab53.net`'s authoritative
nameservers are AWS's:

```
$ dig NS lab53.net  (via DoH)
ns-1128.awsdns-13.org.
ns-1604.awsdns-08.co.uk.
ns-317.awsdns-39.com.
ns-714.awsdns-25.net.
```

This means the *hosted zone* already lives in Route53 regardless of who the
domain *registrar* is — moving the external provider away from Route53 would
require an NS delegation change at the registrar, not just an `external-dns`
config swap. That's a real migration cost to weigh against any alternative.

## External DNS provider: Route53 vs. alternatives

**Route53 cost** (AWS's own pricing page,
<https://aws.amazon.com/route53/pricing/>): $0.50/month for each of the first
25 hosted zones, plus per-query charges (first 1B standard queries/month:
$0.40/million). For a single-operator homelab with one zone and negligible
query volume, this is low-cents/month — trivially within "cheap is fine with
justification."

**ExternalDNS provider support** (upstream README,
<https://github.com/kubernetes-sigs/external-dns>): Route53 is one of
ExternalDNS's original in-tree providers (`docs/tutorials/aws.md`), the most
mature and directly-maintained path — no third-party webhook dependency, no
extra moving part. All non-Route53 options in the current provider list are
either other cloud DNS in-tree providers (Cloud DNS, Azure DNS, etc. —
irrelevant since the zone is already AWS-hosted) or third-party webhook
providers (Cloudflare, Porkbun, DigitalOcean, Hetzner, and ~30 others per the
README's "New providers" table) that would all still require moving the
hosted zone off Route53 first to be useful — extra migration work with no
functional gain, since Route53 already does exactly what's needed and the fee
is negligible.

**Verdict: no reason to move the external zone off Route53.** The zone is
already there, the in-tree provider is first-party/well-maintained, and the
cost is immaterial. The one real hardening opportunity is IAM: the current
setup uses a static access-key-secret IAM user
(`aws-credentials`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) for both
`external-dns-ext` and `ddns-route53`. AWS's own ExternalDNS AWS tutorial
(`docs/tutorials/aws.md`) documents IRSA (IAM Roles for Service Accounts) as
an alternative to static credentials for EKS; the repo's own `irsa.md` already
tracks IRSA as a piece of the machine-identity story, which the platform map
(#1) explicitly defers ("machine identity / workload-to-cloud-API auth
strategy — deliberately deferred"). So: credential hygiene is a legitimate
follow-up, but it's already tracked elsewhere and isn't a reason to change
provider or zone.

## Internal DNS: Unifi webhook vs. alternatives

The internal side is a genuinely different question — Unifi is not just a
DNS host, it's the LAN's DHCP/router, so "internal DNS provider" and "network
appliance" are currently the same box.

**What the Unifi webhook actually does**, per its own README
(`home-operations/external-dns-unifi-webhook` — the project was renamed/moved
from `kashalls/external-dns-unifi-webhook`, confirmed via GitHub API: the old
path now 301s to the new one; the image referenced in
`apps/external-dns/internal-values.yaml`,
`ghcr.io/kashalls/external-dns-unifi-webhook`, still resolves but is the
stale org name):

- It talks to Unifi's official Network **Integration API**
  (`/proxy/network/integration/v1/sites/{siteId}/dns/policies/*`,
  <https://developer.ui.com/network/>) — a real, documented, versioned API
  (requires UniFi Network ≥ 10.3.58), not a scraped/private endpoint.
- Unifi's backing DNS server is **dnsmasq**
  (<https://dnsmasq.org>, cited by the webhook's own README), which imposes
  two hard limitations that are inherent to Unifi, not the webhook:
  wildcard records (`*.example.com`) are unsupported, and only one CNAME per
  name is allowed (the webhook evicts/collapses conflicting records to cope).
- Domain filtering is delegated entirely to the ExternalDNS controller (`--domain-filter`) — Unifi has no zone concept for the webhook to narrow against.

None of that is a bug in the current setup; it's a ceiling built into Unifi's
own DNS backend. If wildcard internal records or multiple CNAME targets are
ever needed, no amount of ExternalDNS tuning fixes it — the DNS backend
itself would need to change.

**Alternatives considered:**

1. **In-tree CoreDNS provider** (ExternalDNS docs,
   `docs/tutorials/coredns.md`): writes records into etcd for a CoreDNS server
   to serve. This is a first-party, well-documented path and removes the
   dnsmasq wildcard/CNAME ceiling entirely. But it requires standing up and
   operating an etcd cluster (or reusing one) purely to back DNS — a new
   stateful dependency for a single-operator homelab, and it still leaves the
   question of how LAN clients (via Unifi DHCP) get pointed at that CoreDNS
   server instead of (or in addition to) Unifi's own resolver. It's the
   correct answer if wildcard/CNAME support becomes a real requirement, but is
   more infrastructure than the current need justifies.
2. **Self-hosted general-purpose resolver (e.g., Technitium, AdGuard Home,
   Pi-hole) as the internal authoritative DNS**, with Unifi DHCP pointing
   clients at it instead of Unifi's own DNS: decouples "router/DHCP" from
   "internal DNS," and most of these have far fewer record-type limitations
   than dnsmasq. This is a real, viable direction — but it's an infra/appliance
   decision (what serves internal DNS at all), not something ExternalDNS
   itself picks for you, and it overlaps with the still-open Unifi capability
   research and VLAN/IPAM design noted as unresolved in the platform map (#1).
   It should be evaluated together with that research, not decided here in
   isolation.
3. **Keep Unifi as-is.** Today's actual internal hostnames are simple
   `A`/single-target records for cluster ingress via Gateway API HTTPRoutes —
   nothing in the current app set needs wildcards or multi-CNAME. The webhook
   itself is actively maintained (recent releases as of this research:
   `home-operations/external-dns-unifi-webhook` changelog shows fixes landing
   within the last few months), talks to a documented, versioned, official
   Ubiquiti API, and requires zero extra infrastructure beyond what's already
   deployed.

**Verdict: keep Unifi for internal DNS for now, but track it as a soft
dependency, not a permanent architectural commitment.** The dnsmasq
limitations (no wildcards, single CNAME) are real and worth stating
explicitly so a future need for wildcard internal records is recognized as
"this requires replacing the internal DNS backend," not "this is an
ExternalDNS misconfiguration." Revisit alongside the Unifi
capability/VLAN-IPAM research rather than pre-emptively standing up CoreDNS+etcd
or a separate resolver with no current requirement driving it.

## Housekeeping note (not a shape change)

`internal-values.yaml` still references the `ghcr.io/kashalls/...` image
path. GitHub confirms that repo now redirects to
`ghcr.io/home-operations/external-dns-unifi-webhook`; the image likely still
resolves under the old path but the project has moved. Bumping the image
repo/tag is a small implementation follow-up, not part of this DNS-shape
decision.

## Recommendation

**Keep the current split — it is the right shape, not an accident:**

- External (`lab53.net` public records): keep `external-dns-ext` on the
  in-tree Route53 provider. The zone is already hosted there (confirmed live),
  the cost is trivial (~$0.50/mo + negligible query cost), and no third-party
  webhook migration would improve on the first-party AWS provider. Only
  follow-up: consider IRSA/short-lived credentials instead of the static IAM
  user, tracked under the already-deferred machine-identity work.
- Internal (`int.lab53.net`-style / LAN-only records): keep
  `external-dns-int` on the Unifi webhook against the documented Integration
  API. It fits today's actual record shapes. Its dnsmasq-imposed ceiling
  (no wildcards, one CNAME per name) is a known, documented constraint —
  revisit only if/when a concrete requirement needs wildcard or multi-target
  CNAME records, at which point CoreDNS+etcd or a dedicated resolver
  (Technitium/AdGuard/Pi-hole) — evaluated jointly with the pending Unifi/VLAN
  research — is the follow-up path, not a reason to change anything now.
- `ddns-route53` is out of scope for this ticket — it is WAN dynamic DNS, not
  application-record management, and needs no change.

## Sources

- `apps/external-dns.ts`, `apps/external-dns/internal-values.yaml`,
  `apps/external-dns/external-values.yaml` (this repo, main branch, read at
  research time)
- ExternalDNS README —
  <https://github.com/kubernetes-sigs/external-dns/blob/master/README.md>
- ExternalDNS AWS/Route53 tutorial —
  <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/aws.md>
- ExternalDNS CoreDNS tutorial —
  <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/coredns.md>
- AWS Route53 pricing — <https://aws.amazon.com/route53/pricing/>
- Live DNS lookup for `lab53.net` NS records (Cloudflare DNS-over-HTTPS,
  `https://cloudflare-dns.com/dns-query`), performed during this research
- Unifi ExternalDNS webhook README —
  <https://github.com/home-operations/external-dns-unifi-webhook/blob/main/README.md>
- Unifi webhook changelog —
  <https://github.com/home-operations/external-dns-unifi-webhook/blob/main/CHANGELOG.md>
- GitHub API confirmation that `kashalls/external-dns-unifi-webhook` has moved
  to `home-operations/external-dns-unifi-webhook` (301 redirect via
  `api.github.com/repos/kashalls/external-dns-unifi-webhook`)
- Ubiquiti Network Integration API — <https://developer.ui.com/network/>
  (referenced by the webhook README for the DNS Policies endpoints)
- dnsmasq — <https://dnsmasq.org> (cited by the webhook README as Unifi's DNS
  backend and the source of the wildcard/CNAME limitations)
- Catalyst platform map, issue #1 (context: current-state snapshot, deferred
  machine-identity work, open Unifi capability research)
