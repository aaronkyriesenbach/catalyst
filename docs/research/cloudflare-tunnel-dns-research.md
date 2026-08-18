# Research: Cloudflare Tunnel DNS-record provisioning mechanics for a Route53-hosted zone

**Ticket**: [#53](https://github.com/aaronkyriesenbach/catalyst/issues/53) — feeds into
[#47, "Decide how traffic reaches the correct cluster across the multi-cluster ingress
topology"](https://github.com/aaronkyriesenbach/catalyst/issues/47) — part of the
["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).
Builds on [#19's resolution](https://github.com/aaronkyriesenbach/catalyst/issues/19) (Cloudflare
Tunnel + Access adopted for remote access) and [#15's resolution](https://github.com/aaronkyriesenbach/catalyst/issues/15)
(`lab53.net` stays authoritative on Route53 — `external-dns-ext` keeps the in-tree AWS provider,
`ddns-route53` keeps the router's public A record current).

**Scope**: This repo's `apps/external-dns.ts` runs `external-dns-ext` against Route53
(`provider: aws`, `sources: ["gateway-httproute"]`, targeting the `traefik-external` Gateway) and
`external-dns-int` against a UniFi webhook, per #15's resolution — no Cloudflare provider exists
today. #19 committed to Cloudflare Tunnel for the external half of remote access, and #47 is about
to decide that every public (`*.lab53.net`) hostname forwards straight to the same Gateway Service
every cluster runs. What #47 does _not_ yet have an answer for is the exact DNS-record mechanism
that gets a public hostname like `app.lab53.net` routed to that tunnel at all, given `lab53.net`'s
nameservers stay on Route53 (Cloudflare's "Partial/CNAME Setup," not "Full Setup"). This document
answers that question against Cloudflare's own docs (`developers.cloudflare.com` only) and
`kubernetes-sigs/external-dns`'s own docs/source. **It does not decide anything.**

---

## TL;DR

- **Cloudflare Tunnel's own docs confirm a Partial-Setup routing shape distinct from Full Setup —
  but it isn't in the page you'd expect.** The Tunnel's dedicated "DNS records" reference
  ([routing-to-tunnel/dns/](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/))
  only describes the Full-Setup shape (CNAME straight to `<UUID>.cfargotunnel.com`) and never
  mentions Partial Setup at all. The Partial-Setup shape is instead spelled out explicitly in two
  other first-party Cloudflare Tunnel/Access docs: the **Tunnels FAQ**'s own dedicated entry, "How
  can Tunnel be used with Partial DNS (CNAME Setup)?", and the **Access "Publish a self-hosted
  application"** guide's own "Partial (CNAME) setup" section. Both state the external-provider
  record must be a CNAME to **`<hostname>.cdn.cloudflare.net`** (e.g.
  `app.lab53.net.cdn.cloudflare.net`) — **not** `<UUID>.cfargotunnel.com` — confirming the general
  CNAME-setup docs' target pattern is exactly what applies to Tunnel too, once Partial Setup is in
  play. `<UUID>.cfargotunnel.com` is the record Cloudflare creates/needs _inside_ its own zone data
  (visible on the DNS Records page regardless of Full/Partial); `<hostname>.cdn.cloudflare.net` is
  what has to exist at the _external_ authoritative provider (Route53) so traffic reaches
  Cloudflare's network in the first place.
- **A one-time, per-zone Cloudflare-account step is required before any per-hostname tunnel
  routing works, and it is gated by cost, not by DNS mechanics.** Cloudflare's own docs state
  plainly: **"A CNAME setup (partial) is only available to customers on a Business or Enterprise
  plan."** Free and Pro-plan zones cannot be Partial-Setup zones at all — only Full Setup (Cloudflare
  nameservers) is available on those tiers. The one-time step itself (add the zone, choose
  Business/Enterprise, "Convert to CNAME DNS Setup," add a Cloudflare-issued **verification TXT
  record** at Route53) does **not** touch nameservers — ownership is proven via TXT, explicitly
  contrasted with Full Setup's nameserver-change flow. So the _mechanism_ doesn't reopen #15, but
  the _cost_ of using it does introduce a new consideration #15 didn't have to weigh, since Full
  Setup (the $0 option) is exactly the nameserver-delegation path #15 already rejected.
- **`external-dns`'s Cloudflare provider has no concept of Cloudflare Tunnel at all** — confirmed
  by a zero-hit search for "tunnel"/"cfargotunnel"/"cdn.cloudflare.net" across its provider source
  (`provider/cloudflare/cloudflare.go`) and its own tutorial doc. It manages ordinary DNS records
  (A/AAAA/CNAME/TXT/SRV/etc.) _inside a Cloudflare-hosted zone_ via Cloudflare's DNS API, plus a
  separate, unrelated "custom hostname" flag for the **Cloudflare for SaaS** product (vanity-domain
  hosting for a SaaS provider's _customers_ — not what Tunnel routing needs). It is therefore not a
  provider that could write the required Route53-side record at all — that record still belongs to
  the AWS/Route53 provider already running in this repo. The good news: the target value
  (`<hostname>.cdn.cloudflare.net`) is a **pure string transform of the hostname**, needing no
  Cloudflare API call to look up — but `external-dns`'s Gateway API integration only supports a
  target _override_ on the **Gateway** (one shared value for every Route attached to it), not a
  per-Route/per-hostname value, so today's `gateway-httproute` + AWS-provider setup cannot express
  "each hostname gets its own distinct computed target" without a second, differently-sourced
  mechanism (`external-dns`'s CRD/`DNSEndpoint` source, which does accept arbitrary per-record
  targets, still against the same AWS/Route53 provider — not a Cloudflare provider).
- **No nameserver delegation is implied or required** by any Partial-Setup mechanism found — that
  is precisely Partial Setup's reason to exist, confirmed directly ("the domain uses non-Cloudflare
  DNS servers," ownership proven via TXT record, not NS). Full Setup remains the only path in
  Cloudflare's own docs that touches nameservers, and nothing here points toward it.
- **Free-tier findings**: Cloudflare Tunnel's own account limits (1,000 tunnels, 1,000 CIDR+hostname
  routes, 25 active replicas per tunnel) are **not** gated by plan tier in Cloudflare's own reference
  table — a single-operator homelab is nowhere near these ceilings regardless of plan. The one real
  gate found is the Partial-Setup **zone plan** requirement above (Business/Enterprise, zone-level,
  separate from the Zero Trust/Access plan #19 already assumed stays Free). The unrelated "custom
  hostname" (Cloudflare for SaaS) feature — which `external-dns`'s Cloudflare provider _can_
  automate — is a different product for a different purpose (SaaS vanity-domain hosting) and isn't
  gated the same way, but is also not the mechanism this repo needs.

---

## Question 1: Does Cloudflare Tunnel's own DNS-routing docs explicitly describe a Partial-Setup routing shape? What's the real external-provider record?

### The dedicated "DNS records" page only shows the Full-Setup shape

Cloudflare Tunnel's own DNS-routing reference states: _"When you create a tunnel, Cloudflare
generates a subdomain at `<UUID>.cfargotunnel.com`. You point a CNAME record at this subdomain to
route traffic from your hostname to the tunnel."_ — [Cloudflare Tunnel: DNS
records](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/).
The walkthrough it gives (**Type**: CNAME, **Name**: subdomain, **Target**: `<UUID>.cfargotunnel.com`)
never mentions Partial Setup, Business/Enterprise plans, or `.cdn.cloudflare.net` anywhere on the
page. Read in isolation, this page (and the sibling ["Published
applications"](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/)
overview, which repeats the same `<UUID>.cfargotunnel.com` framing) would lead you to believe
`<UUID>.cfargotunnel.com` is _the_ record to create anywhere DNS is managed — which is only true
for Full Setup, where Cloudflare _is_ that DNS provider.

### The Partial-Setup shape is confirmed, explicitly, in Tunnel's own FAQ and Access's own walkthrough

Cloudflare's own **Tunnels FAQ** has a dedicated entry for exactly this case: _"How can Tunnel be
used with Partial DNS (CNAME Setup)? ... You can still use Tunnel with Partial Setup. You will
need to create a new DNS record with your current DNS provider for each new hostname connected
through Cloudflare Tunnel. The DNS record should be of type CNAME or ALIAS if it is on the root of
the domain. The name of the record should be the subdomain it corresponds to (e.g. `example.com`
or `tunnel.example.com`) and **the value of the record should be
`subdomain.domain.tld.cdn.cloudflare.net`**."_ — [Cloudflare One FAQ: Tunnels
FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/). The same FAQ
entry adds: _"The best experience with Cloudflare Tunnel is using Full Setup because Cloudflare
manages DNS for the domain and can automatically configure DNS records for newly started
Tunnels"_ — an explicit acknowledgment that Partial Setup is the worse-ergonomics, still-fully-
supported alternative.

The FAQ entry links onward to a full worked example, in Access's own self-hosted-application guide,
with its own dedicated **"Partial (CNAME) setup"** section: _"If your domain uses a partial
(CNAME) setup, Cloudflare does not manage your DNS zone. You must manually create DNS records at
your external provider after adding a published application route to your tunnel... In a full DNS
setup, Cloudflare automatically creates DNS records when you add a published application route to
a tunnel. In a partial (`CNAME`) setup, you must add a CNAME record at the DNS provider that hosts
your domain (your authoritative DNS provider). At your external DNS provider, create a CNAME
record with the following values: **Name**: The hostname you configured in the tunnel (for
example, `app.example.com`); **Target**: `<HOSTNAME>.cdn.cloudflare.net` (for example,
`app.example.com.cdn.cloudflare.net`)"_ — [Cloudflare Access: Publish a self-hosted application to
the Internet — Partial (CNAME)
setup](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#partial-cname-setup).

### Reconciling the two targets: two different records, two different places

Both targets are real and both matter, but they're not interchangeable and don't live in the same
place:

- **`<UUID>.cfargotunnel.com`** is the record Cloudflare's own edge needs _inside its zone data for
  `lab53.net`_ to know which tunnel to proxy a given hostname to. This exists (and is
  editable/visible on the Cloudflare dashboard's DNS Records page) whether the zone is Full or
  Partial — the general Partial-Setup DNS-resolution reference describes this "record within the
  same zone" case directly: _"Cloudflare would show a warning if you had the following records in
  your partial zone: `sub1.partialzone.com CNAME sub2.partialzone.com` / `sub2.partialzone.com A
192.0.2.1`... our DNS resolution will send incoming HTTP requests to `sub1.partialzone.com` to
  the origin `192.0.2.1`"_ — i.e. Cloudflare's proxy still consults its own internal zone record
  (here a CNAME to `<UUID>.cfargotunnel.com` for a Tunnel case) to decide where to send a
  connection **once that connection has already reached Cloudflare's network** — [Cloudflare DNS:
  DNS resolution in partial
  zones](https://developers.cloudflare.com/dns/zone-setups/partial-setup/dns-resolution/).
- **`<hostname>.cdn.cloudflare.net`** is what has to exist at the _authoritative_ provider
  (Route53) so that a public DNS lookup for `app.lab53.net` resolves to Cloudflare's network at
  all in the first place, since Cloudflare isn't the authoritative nameserver for a Partial-Setup
  zone. This is the record the Tunnel FAQ and the Access walkthrough both call out explicitly as
  the Partial-Setup-specific step.

So: for this repo's case (Partial Setup, since #15 keeps Route53 authoritative), the record that
needs to live **at Route53** is a CNAME to `app.lab53.net.cdn.cloudflare.net` per hostname — the
general CNAME-setup docs' target pattern the ticket suspected, now confirmed directly from Tunnel's
own FAQ and Access's own walkthrough, not just the generic DNS-product docs.

---

## Question 2: Is a one-time Cloudflare-account-side step required to add `lab53.net` as a Partial/CNAME zone, and what does it require operationally?

Yes. Both the Access walkthrough's prerequisites (_"An active domain on Cloudflare... Domain uses
either a full setup or a partial (CNAME) setup"_ —
[self-hosted-public-app](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/#prerequisites))
and the tunnel-route-creation docs (_"Before you publish an application through your tunnel, you
must [add a website to
Cloudflare](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/)"_ —
[Create a tunnel
(dashboard)](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/#2a-publish-an-application),
repeated verbatim in [Add
routes](https://developers.cloudflare.com/cloudflare-one/networks/routes/add-routes/#add-a-published-application-route))
state this as a hard prerequisite before _any_ per-hostname tunnel route can be published — separate
from, and prior to, the per-app hostname step in Question 1.

**Availability is plan-gated, not just an onboarding checkbox.** Cloudflare's own DNS-setups
reference states: _"A CNAME setup (partial) is only available to customers on a Business or
Enterprise plan. Partial setups are not supported on Cloudflare Registrar domains"_ — with an
explicit table confirming **Free: No, Pro: No, Business: Yes, Enterprise: Yes** — [Cloudflare DNS:
CNAME setup (Partial)](https://developers.cloudflare.com/dns/zone-setups/partial-setup/). The
"Onboard a domain" guide frames the _default_/most-common path as Full Setup and only gestures at
Partial Setup as a "Further option" — [Cloudflare Fundamentals: Onboard a
domain](https://developers.cloudflare.com/fundamentals/manage-domains/add-site/#other-dns-setups) —
so following that doc's main path naively leads toward nameserver delegation, not Partial Setup;
Partial Setup has to be deliberately chosen.

**The setup steps themselves, once on the right plan** — [Cloudflare DNS: Set up a partial zone
(CNAME setup)](https://developers.cloudflare.com/dns/zone-setups/partial-setup/setup/):

1. Add the domain to a Cloudflare account and choose the Business or Enterprise plan (_"Make sure
   your zone is on the Business or Enterprise plan. If you have Free or Pro, the options mentioned
   below will not be displayed"_), or, for a first-time zone add via API, create it directly with
   `"type": "partial"`.
2. Select **Convert to CNAME DNS Setup**, which generates a **Verification TXT Record** — this
   must be added at the authoritative provider (Route53): _"Add the Verification TXT Record at
   your authoritative DNS provider. Cloudflare will verify the TXT record and send a confirmation
   email... The verification record must remain in place for as long as your domain is active on a
   CNAME setup on Cloudflare."_
3. Add per-hostname CNAME records at Route53 pointing at `{hostname}.cdn.cloudflare.net` (Question
   1's mechanism) for each subdomain that should be proxied.

**No nameserver change is part of this flow** — the same doc contrasts this explicitly with Full
Setup's nameserver-update step, and the onboarding guide's Partial-Setup path says outright:
_"If you are onboarding a new domain to Cloudflare, ignore the instructions to change your
nameservers"_ when a non-Full setup is chosen.

One operational wrinkle worth flagging, not resolved here: Universal SSL certificate coverage for
a Partial-Setup subdomain isn't automatic at zone-conversion time — _"If you are only using
Universal SSL prior to converting your zone, a certificate will be provisioned for your subdomains
only after each of the respective DNS records... are proxied"_ — [Set up a partial zone (CNAME
setup)](https://developers.cloudflare.com/dns/zone-setups/partial-setup/setup/#before-you-begin).
So each newly-proxied hostname has its own certificate-issuance lag/step, on top of the DNS record
itself.

---

## Question 3: Is the per-hostname CNAME-target provisioning automatable via `external-dns`'s Cloudflare provider?

### `external-dns`'s Cloudflare provider has no Tunnel awareness at all

A direct search of `kubernetes-sigs/external-dns`'s Cloudflare provider source
(`provider/cloudflare/cloudflare.go`, current `master`) and its own tutorial doc for `tunnel`,
`cfargotunnel`, or `cdn.cloudflare.net` returns **zero matches**. The provider's own tutorial
describes exactly what it does instead: manage ordinary DNS records (A/AAAA/CNAME/TXT/SRV/CAA,
etc.) inside a Cloudflare-hosted zone via Cloudflare's DNS API — proxied-status toggling
(`--cloudflare-proxied` / `external-dns.kubernetes.io/cloudflare-proxied`), regional-hostname
routing, DNS record tags, and a separate `--cloudflare-custom-hostnames` flag for **Cloudflare for
SaaS** custom hostnames (_"Automatic configuration of Cloudflare custom hostnames (using A/CNAME
DNS records as custom origin servers)... Requires [Cloudflare for
SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) product and
'SSL and Certificates' API permission"_) — [external-dns: Cloudflare DNS
tutorial](https://raw.githubusercontent.com/kubernetes-sigs/external-dns/master/docs/tutorials/cloudflare.md).
Cloudflare for SaaS's own docs confirm this is a distinct product for a distinct purpose — letting
a SaaS provider's _customers_ bring vanity domains to the provider's shared infrastructure, not for
routing a homelab's own app hostnames through a Cloudflare Tunnel: _"Cloudflare for SaaS allows
you, as a SaaS provider, to extend the benefits of Cloudflare products to custom domains by adding
them to your zone as custom hostnames"_ — [Cloudflare for Platforms: Custom
hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/).
This is worth flagging directly against the ticket's own framing, since the ticket's language
("registering each hostname as a Cloudflare 'custom hostname'") reads as if it may have conflated
this specific SaaS feature with the plain Partial-Setup CNAME mechanism Question 1 confirmed is
what Tunnel actually needs — they are unrelated Cloudflare products that happen to share the word
"hostname."

Even setting the naming confusion aside: an `external-dns` Cloudflare provider, if this repo added
one, would write records **inside a Cloudflare-hosted zone via Cloudflare's API** — it could not
write the record this repo actually needs (the Route53-side CNAME to
`{hostname}.cdn.cloudflare.net`), because that record lives at the _external, authoritative_
provider, which for this repo is Route53, not Cloudflare. That's exactly the job the existing
`external-dns-ext` (AWS/Route53 provider) already does.

### The real question: can the existing Route53 provider express a per-hostname computed target?

The good news, confirmed in Question 1: `{hostname}.cdn.cloudflare.net` is a **pure, deterministic
string transform of the hostname itself** — no Cloudflare API lookup is needed to know what value
to write, unlike (for example) an ALB's dynamically-assigned DNS name.

The complication is in how `external-dns`'s Gateway API integration reads target overrides.
`external-dns`'s own Gateway API docs state the placement rule directly: _"ExternalDNS reads
different annotations from different Gateway API resources: **Gateway annotations**: Only
`external-dns.kubernetes.io/target` is read from Gateway resources... **Route annotations**: All
other annotations (hostname, ttl, controller, provider-specific) are read from Route
resources"_ — and call out the mistake explicitly: _"Placing `target` annotation on HTTPRoute...
This annotation is ignored on Routes"_ — [external-dns: Gateway API Route
Sources](https://raw.githubusercontent.com/kubernetes-sigs/external-dns/master/docs/sources/gateway-api.md).
The `target` annotation itself is defined as _"a comma-separated list of values to override the
resource's DNS record targets"_ — [external-dns:
Annotations](https://raw.githubusercontent.com/kubernetes-sigs/external-dns/master/docs/annotations/annotations.md) —
i.e. one fixed value (or fixed list), scoped to the whole Gateway, shared by every `HTTPRoute`
attached to it. This repo's convention is exactly the shape that collides with that: one shared
`traefik-external` Gateway with many per-app `HTTPRoute`s, each needing a **different** computed
target (`app-a.lab53.net.cdn.cloudflare.net`, `app-b.lab53.net.cdn.cloudflare.net`, ...). The
Gateway-level `target` annotation mechanism, as documented, has no way to express "compute a
different value per Route's hostname" — it's one value (or list) for the whole Gateway.

`external-dns`'s **CRD source** (`DNSEndpoint` custom resources) is the one place in
`external-dns`'s own docs that does accept an arbitrary, per-record `dnsName`/`targets` pair
directly, independent of any Gateway/Service discovery: _"CRD source watches for a user specified
CRD to extract Endpoints from its Spec... `DNSName`: The hostname of the DNS record... `Targets`:
The targets the DNS record points to"_ — [external-dns: CRD
Source](https://raw.githubusercontent.com/kubernetes-sigs/external-dns/master/docs/sources/crd.md).
This is provider-agnostic — it would still write through the same AWS/Route53 provider already
configured, not a new Cloudflare one — but it is a **different `--source`** than this repo's
current `gateway-httproute`-only configuration, and since `{hostname}.cdn.cloudflare.net` is a
pure string transform, a companion `DNSEndpoint` object per app is, in principle, something this
repo's own `apps/*.ts` code could generate deterministically from the app's own hostname value (no
external lookup, no Cloudflare API credential needed for this half) — as opposed to the Gateway's
`target` annotation route, which this research did not find a way to make per-hostname.

**Net for Question 3**: the two production-grade capabilities on offer — `external-dns`'s
Cloudflare provider (writes into Cloudflare's own zone, not Route53, and has zero Tunnel
awareness) and its Gateway-level `target` annotation (writes into Route53 via the AWS provider
already in use, but is Gateway-scoped, not per-hostname) — do not, by themselves, reproduce
today's fully-automatic per-app Route53 record flow for this specific target value. A third
option surfaced by the docs (the CRD/`DNSEndpoint` source, still against the existing AWS
provider) is structurally capable of a per-hostname computed target, but is a different mechanism
from the one this repo's `HTTPRoute`s already drive, not a drop-in extension of it.

---

## Question 4: Does any of this require or imply nameserver delegation away from Route53 (reopening #15)?

**No mechanism found here requires it.** Every Partial-Setup source consulted is explicit that
this is precisely the point of the "Partial (CNAME) Setup" designation: _"CNAME setup (also known
as partial setup) allows you to use Cloudflare's reverse proxy while maintaining your primary and
authoritative DNS provider"_ — [Cloudflare DNS: DNS
setups](https://developers.cloudflare.com/dns/zone-setups/index.md); the Tunnel FAQ frames Full
vs. Partial as _"the domain uses Cloudflare DNS nameservers"_ vs. _"the domain uses non-Cloudflare
DNS servers"_ — [Tunnels FAQ](https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/);
and zone ownership for a Partial setup is proven via a TXT record, not a nameserver change, with
the TXT record's presence being the ongoing proof of control (_"The verification record must
remain in place for as long as your domain is active on a CNAME setup on Cloudflare"_) — [Set up a
partial zone (CNAME
setup)](https://developers.cloudflare.com/dns/zone-setups/partial-setup/setup/#2-verify-ownership-for-your-domain).

**Flagging clearly, per the ticket's ask**: the only path in any of these docs that _does_ involve
nameserver delegation is **Full Setup** — the path Cloudflare's own docs call "the best experience"
for Tunnel and "the most common option" generally, and the path the "Onboard a domain" guide
defaults to unless Partial Setup is deliberately chosen instead. Nothing found in this research
pushes toward adopting Full Setup — Partial Setup is confirmed, by Cloudflare's own docs, to be a
fully supported (if more manual) alternative for Tunnel routing specifically — but it's worth
naming plainly that Full Setup remains on the table as _a_ documented option, and choosing it would
reopen #15's decision. That choice is not implied or required by anything found here.

---

## Question 5: Free-tier limitations relevant to a single-operator homelab

- **The binding constraint is the zone's DNS plan, not Cloudflare Tunnel itself.** Partial (CNAME)
  Setup is unavailable on Free or Pro zone plans — confirmed directly: _"Availability | Free: No |
  Pro: No | Business: Yes | Enterprise: Yes"_ — [Cloudflare DNS: CNAME setup
  (Partial)](https://developers.cloudflare.com/dns/zone-setups/partial-setup/#availability). This
  is a **zone-level** plan (the DNS/CDN/WAF product for `lab53.net` specifically), separate from
  the account-level **Zero Trust/Cloudflare One** plan that #19 already assumed stays Free for
  Tunnel + Access. In other words: keeping Tunnel + Access on a Free Zero Trust plan (per #19) does
  not, by itself, unlock Partial Setup for the zone — Partial Setup is gated by the zone's own plan
  tier, independent of the Zero Trust plan choice.
- **Cloudflare Tunnel's own account limits are generous and not plan-gated in Cloudflare's own
  reference table**: _"cloudflared tunnels per account: 1,000 | Routes (CIDR routes + Hostname
  routes) per account: 1,000 (shared with Cloudflare Mesh) | Active cloudflared replicas per
  tunnel: 25 | Virtual networks per account: 1,000"_ — [Cloudflare One: Account
  limits](https://developers.cloudflare.com/cloudflare-one/account-limits/#cloudflare-tunnel). A
  single-operator homelab's app count is nowhere near these ceilings; unlike the zone-plan gate
  above, this table does not list Tunnel limits as varying by plan the way it explicitly does for
  Digital Experience Monitoring elsewhere on the same page.
- **The unrelated "custom hostname" (Cloudflare for SaaS) feature — the one `external-dns`'s
  Cloudflare provider can actually automate — is bundled differently, but is also not the
  mechanism this repo needs.** Cloudflare for SaaS's own overview states: _"Cloudflare for SaaS is
  bundled with non-Enterprise plans and available as an add-on for Enterprise plans"_ —
  [Cloudflare for Platforms:
  Overview](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) — i.e.
  broader availability than Partial-Setup DNS zones, but irrelevant here since (per Question 3)
  it solves a different problem (SaaS vanity-domain hosting) than routing this repo's own
  `*.lab53.net` hostnames to a Cloudflare Tunnel.
- No other Cloudflare Free-tier ceiling specific to Partial-Setup zones, DNS record counts, or
  Tunnel hostname routes was found in the pages consulted; the zone-plan gate above is the one
  concrete, sourced limitation this research surfaced.

---

## Recommendation

None — research only, per this ticket's own instructions. This document resolves the specific
factual questions #53 posed (Tunnel's own Partial-Setup DNS shape, the one-time zone-onboarding
step and its Business/Enterprise gate, `external-dns`'s actual Cloudflare-provider capabilities,
the no-nameserver-delegation confirmation, and the relevant Free-tier ceiling) without deciding
anything about how #47 or `apps/external-dns.ts` should actually be shaped going forward — that
remains for the grilling session on [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47).

---

## Sources

- Cloudflare Tunnel — DNS records — <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/>
- Cloudflare Tunnel — Published applications — <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/>
- Cloudflare Tunnel — Create a tunnel (dashboard) — <https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/>
- Cloudflare One — Add routes — <https://developers.cloudflare.com/cloudflare-one/networks/routes/add-routes/>
- Cloudflare One — Tunnels FAQ — <https://developers.cloudflare.com/cloudflare-one/faq/cloudflare-tunnels-faq/>
- Cloudflare Access — Publish a self-hosted application to the Internet (Partial (CNAME) setup section) — <https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/>
- Cloudflare One — Account limits — <https://developers.cloudflare.com/cloudflare-one/account-limits/>
- Cloudflare One — Seat management — <https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/>
- Cloudflare One — Getting started with Cloudflare Zero Trust FAQ — <https://developers.cloudflare.com/cloudflare-one/faq/getting-started-faq/>
- Cloudflare DNS — DNS setups — <https://developers.cloudflare.com/dns/zone-setups/>
- Cloudflare DNS — CNAME setup (Partial) — <https://developers.cloudflare.com/dns/zone-setups/partial-setup/>
- Cloudflare DNS — Set up a partial zone (CNAME setup) — <https://developers.cloudflare.com/dns/zone-setups/partial-setup/setup/>
- Cloudflare DNS — DNS resolution in partial zones — <https://developers.cloudflare.com/dns/zone-setups/partial-setup/dns-resolution/>
- Cloudflare Fundamentals — Onboard a domain — <https://developers.cloudflare.com/fundamentals/manage-domains/add-site/>
- Cloudflare for Platforms — Cloudflare for SaaS overview — <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/>
- Cloudflare for Platforms — Custom hostnames — <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/>
- Cloudflare docs `llms.txt` indexes (used to enumerate pages) — <https://developers.cloudflare.com/llms.txt>, <https://developers.cloudflare.com/cloudflare-one/llms.txt>
- `kubernetes-sigs/external-dns` — Cloudflare DNS tutorial — <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/cloudflare.md>
- `kubernetes-sigs/external-dns` — Cloudflare provider source (`provider/cloudflare/cloudflare.go`, searched for `tunnel`/`cfargotunnel`/`cdn.cloudflare.net`) — <https://github.com/kubernetes-sigs/external-dns/blob/master/provider/cloudflare/cloudflare.go>
- `kubernetes-sigs/external-dns` — Gateway API Route Sources — <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/sources/gateway-api.md>
- `kubernetes-sigs/external-dns` — Annotations reference — <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/annotations/annotations.md>
- `kubernetes-sigs/external-dns` — CRD Source — <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/sources/crd.md>
- `kubernetes-sigs/external-dns` — AWS (Route53) tutorial (ALIAS vs. CNAME behavior) — <https://github.com/kubernetes-sigs/external-dns/blob/master/docs/tutorials/aws.md>
- `kubernetes-sigs/external-dns` — README (webhook providers list, confirming no Cloudflare Tunnel webhook exists) — <https://github.com/kubernetes-sigs/external-dns/blob/master/README.md>
- catalyst repo (current-state context): `apps/external-dns.ts`, `apps/external-dns/external-values.yaml`, `apps/external-dns/internal-values.yaml`, `utils.ts` (`appHostname` — confirms `<name>.lab53.net` / `<name>.int.lab53.net` single-level hostname convention)
- catalyst repo issues/resolutions consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)
  (wayfinder map), [#15](https://github.com/aaronkyriesenbach/catalyst/issues/15) (DNS approach
  resolution — Route53 stays authoritative), [#19](https://github.com/aaronkyriesenbach/catalyst/issues/19)
  (remote-access/tunnel approach resolution — Cloudflare Tunnel + Access), [#47](https://github.com/aaronkyriesenbach/catalyst/issues/47)
  (follow-on ticket this research feeds)
- Sibling research (style/rigor reference): `docs/research/loadbalancer-talos-research.md` (branch
  `research/loadbalancer-talos-research`, [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46))
