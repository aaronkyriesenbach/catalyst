# Research: Remote-access/tunnel options

Ticket: [#18](https://github.com/aaronkyriesenbach/catalyst/issues/18) (part of the "Homelab platform rearchitecture" wayfinder map, [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1))

## Question

Survey remote-access/tunnel options for two distinct problems:

- **(a) Publish:** external services reachable from anywhere at `service.lab53.net`, without exposing ports directly on the router.
- **(b) Reach-in:** access the internal-only home network from elsewhere, without installing WireGuard/VPN certs on every connecting device.

Constraints: single-operator homelab, `lab53.net` is fixed and must be usable flexibly, free-tier-first (cheap is fine with justification), no exposed inbound ports on the router (hard requirement), Unifi router hardware is fixed but reconfigurable.

**Bottom line up front:** (a) and (b) are different problems and are best solved with different tools (or two features of the same tool). No single option is clearly best at both without caveats — see [Recommendation](#recommendation).

---

## Tailscale

Primary sources: [Subnet routers](https://tailscale.com/kb/1019/subnets), [Tailscale Funnel](https://tailscale.com/kb/1223/funnel), [Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https), [Pricing](https://tailscale.com/pricing).

### How it works

- Tailscale is a mesh WireGuard overlay ("tailnet"). Devices run the Tailscale client and authenticate via SSO; the control plane distributes WireGuard keys and (where possible) sets up direct peer-to-peer connections, falling back to relay ("DERP") servers Tailscale operates. ([Subnet routers](https://tailscale.com/kb/1019/subnets))
- **Subnet routers** let one tailnet device advertise routes to a physical subnet (e.g. the whole home LAN), so other tailnet devices can reach non-Tailscale hosts on that subnet without installing the client on each of them. Devices *behind* a subnet router don't count against the plan's device limit. ([Subnet routers](https://tailscale.com/kb/1019/subnets))
- **Tailscale Funnel** exposes a *local* resource on a device to the public internet through a Funnel relay server, without opening inbound ports. It requires MagicDNS + HTTPS certs enabled for the tailnet, and is available on all plans (beta status as of the docs snapshot). ([Funnel](https://tailscale.com/kb/1223/funnel))

### Custom domain support — the key limitation

- Funnel URLs **can only use DNS names in the tailnet's own domain** (`tailnet-name.ts.net`) — this is an explicit, stated limitation: *"Funnel can only use DNS names in your tailnet's domain (`tailnet-name.ts.net`)."* ([Funnel](https://tailscale.com/kb/1223/funnel))
- Tailscale's HTTPS/cert feature (`tailscale cert`) issues Let's Encrypt certs **for the tailnet name only**; there is no mechanism to attach an arbitrary custom domain like `service.lab53.net` to a tailnet node or a Funnel endpoint. ([Enabling HTTPS](https://tailscale.com/kb/1153/enabling-https))
- **Consequence for requirement (a):** Tailscale Funnel cannot directly serve `service.lab53.net`. You'd need to reverse-proxy from something at that domain to the `*.ts.net` Funnel URL, which reintroduces a public-facing component and defeats the "no exposed ports" simplicity Funnel otherwise offers.
- Note: "custom domain" in Tailscale's own docs/pricing refers to the **email domain used to sign up** (e.g. `@example.com`), which determines personal-vs-business billing — unrelated to DNS routing. ([Pricing FAQ](https://tailscale.com/pricing))

### Reaching the internal network (b)

- Subnet routers satisfy the "don't install on every internal device" half (printers, NAS, etc. don't need the client) — but **the connecting/remote device still needs the Tailscale client installed and logged in** to reach anything through the subnet router. There is no clientless/browser-based access mode in Tailscale's own docs.

### Pricing (free tier)

- **Personal plan: free forever**, up to 6 users, unlimited user devices, subnet routers/exit nodes included, up to 50 tagged resources/month, Funnel included. Personal use is auto-detected from a personal email domain (Gmail, iCloud, etc.); a custom company email domain triggers a free *trial* of a paid plan instead of the Personal plan. ([Pricing](https://tailscale.com/pricing))
- Paid tiers (Standard $8/user/mo, Premium $18/user/mo) add SCIM, more ACL groups, etc. — not needed for a single-operator homelab.

### Verdict

Good, free, zero-config option for (b) if a Tailscale client on the roaming device is acceptable — but it does not satisfy "no client install" for (b), and it **cannot serve `lab53.net` at all** for (a).

---

## NetBird

Primary sources: [Self-hosted vs. Cloud-hosted](https://docs.netbird.io/about-netbird/self-hosted-vs-cloud), [Getting Started](https://docs.netbird.io/how-to/getting-started), [Plans and billing](https://docs.netbird.io/manage/settings/plans-and-billing), [Browser Client](https://docs.netbird.io/manage/peers/browser-client).

### How it works

- Also a WireGuard-based mesh overlay, functionally similar to Tailscale: peers connect directly when possible, with policy-based access control. ([Getting Started](https://docs.netbird.io/how-to/getting-started))
- **Remote Network Access**: a single "routing peer" is installed inside the private network (e.g. one machine on the home LAN) and acts as a gateway; a CIDR-based "Network Resource" (e.g. the whole home subnet) is defined once, so other devices on that LAN don't need the client — directly analogous to Tailscale's subnet router. ([Getting Started](https://docs.netbird.io/how-to/getting-started))
- **Browser Client (WASM)**: NetBird can run a full NetBird peer as WebAssembly *inside the browser*, giving SSH and RDP access to resources with **no client software install at all** — a real point of differentiation from Tailscale for requirement (b). Requires the target peer to have SSH/RDP access enabled and an admin NetBird account to grant a temporary ACL. ([Browser Client](https://docs.netbird.io/manage/peers/browser-client))
- No Funnel-equivalent for exposing an arbitrary public HTTP(S) hostname at a custom domain — NetBird's docs describe it purely as a private/Zero-Trust network access tool, not a public reverse-proxy/tunnel service. It is **not** a fit for requirement (a).

### Self-hosting for homelabs

- As of NetBird 0.62+, self-hosting no longer requires a separate external IdP — local user management is built into the Management service, cutting the container count from 7+ to 4-5 and RAM from 2-4 GB to ~1 GB, explicitly called out as making self-hosting "a more viable option for homelabs." ([Self-hosted vs. Cloud-hosted](https://docs.netbird.io/about-netbird/self-hosted-vs-cloud))
- Self-hosted trade-offs vs. cloud: you must run your own relay servers (single instance, or DIY geo-distribution) and there's no HA control plane out of the box. NetBird's own comparison table lists "Homelabs, air-gapped networks, compliance requirements" as the best-fit use case for self-hosting. ([Self-hosted vs. Cloud-hosted](https://docs.netbird.io/about-netbird/self-hosted-vs-cloud))

### Pricing (cloud, free tier)

- **Free Plan**: up to 5 users and 100 machines, peer-to-peer connections, encryption, access control, routing, private DNS, and SSO via Google Workspace/Azure/Okta. ([Plans and billing](https://docs.netbird.io/manage/settings/plans-and-billing))
- Paid tiers are usage-based: Team €6/user/mo, Business €12/user/mo, with machine-allowance formulas (100 free machines + 10/paid user). Billing is based on active (logged-in) users/machines only. ([Plans and billing](https://docs.netbird.io/manage/settings/plans-and-billing))
- Self-hosting the open-source Community Edition avoids all of this and is free indefinitely (AGPL-style OSS, per the getting-started/self-hosting docs), at the cost of operating the relay/signal/management containers yourself.

### Verdict

Best-in-class for (b) if you want zero-install browser access to specific SSH/RDP hosts, and free/cheap either via the 5-user cloud free tier or full self-hosting. Not usable for (a) at all.

---

## Pangolin

Primary sources: [How Pangolin Works](https://docs.pangolin.net/about/how-pangolin-works), [Pangolin vs. Proxy vs. VPN](https://docs.pangolin.net/about/pangolin-vs-reverse-proxy-vs-vpn), [Domains](https://docs.pangolin.net/manage/domains), [Quick Install Guide](https://docs.pangolin.net/self-host/quick-install), [Understanding Clients](https://docs.pangolin.net/manage/clients/understanding-clients), [Host (private resource)](https://docs.pangolin.net/manage/resources/private/host), [Browser-rendered terminal note is Cloudflare's — Pangolin's equivalent covered inline below].

### How it works

Pangolin is a single self-hostable (or cloud) platform that explicitly combines reverse-proxy and VPN capabilities:

- A **site** (via the "Newt" connector) creates an **outbound-only** tunnel from a network (e.g. your home LAN/k3s cluster) to the Pangolin server — no open inbound ports on that network, satisfying the "no exposed ports on the router" requirement directly. ([How Pangolin Works](https://docs.pangolin.net/about/how-pangolin-works))
- **Public resources** (a): HTTP/HTTPS, SSH, RDP, VNC, and raw TCP/UDP can all be published through the Pangolin server as identity-aware reverse proxies. SSH/RDP/VNC render *in the browser* — no client software needed by the person connecting. HTTP/HTTPS resources get automatic TLS and can sit at any hostname you configure. ([Pangolin vs. Proxy vs. VPN](https://docs.pangolin.net/about/pangolin-vs-reverse-proxy-vs-vpn))
- **Private resources** (b): host/CIDR/HTTP(S)/SSH resources reachable only when connected through a Pangolin client (Mac/Windows/Linux/iOS/Android) or the `pangolin ssh` CLI — functions like a scoped zero-trust VPN, still requiring a client on the connecting device for anything beyond the browser-rendered public resource types. ([Understanding Clients](https://docs.pangolin.net/manage/clients/understanding-clients), [Host](https://docs.pangolin.net/manage/resources/private/host))

### Domain flexibility for `lab53.net` (a)

Pangolin's domains doc lays out three domain models ([Domains](https://docs.pangolin.net/manage/domains)):

| Type | DNS record | Coverage | Availability |
|---|---|---|---|
| Wildcard | A/AAAA | base domain + all subdomains | **Self-hosted** |
| Domain Delegation | NS | base domain + all subdomains, Pangolin-managed | Cloud |
| Single Domain | CNAME | exact hostname only | Cloud |

- Self-hosting Pangolin on a VPS with a wildcard `A`/`AAAA` record for `*.lab53.net` gives full, flexible use of the domain for any `service.lab53.net` you want, with DNS staying at your existing registrar. Cloud plans instead require delegating nameservers or adding per-hostname CNAMEs to Pangolin's infrastructure.

### Self-hosting requirements

The self-hosted Community Edition installer requires ([Quick Install Guide](https://docs.pangolin.net/self-host/quick-install)):
- A Linux server with a **public IP** and open ports **80/tcp, 443/tcp, 51820/udp, 21820/udp**.
- This server is the Pangolin control-plane/edge (e.g. a $4-6/mo VPS) — **not** the home router or homelab network. The homelab's k3s cluster connects out to this VPS via an outbound Newt tunnel, so the router itself never needs a forwarded port.

### Pricing

- **Community Edition (self-hosted): free**, AGPLv3, community support — this is the natural fit for a single-operator homelab wanting to use its own domain flexibly at zero operator cost (beyond a small VPS).
- **Pangolin Cloud "Basic" plan: free**, up to 5 users, custom domains (via CNAME/delegation), public + private resources, peer-to-peer connections — no credit card required. (extracted from Pangolin's pricing data: `plans":[{"id":"basic","tier":"Basic","price":"Free"...}]`, https://digpangolin.com/pricing)
- Paid Pangolin Cloud tiers start at Team ($4/user/mo) and Business ($9/user/mo); self-hosted Enterprise licensing starts at $449/yr (Starter) for wildcard resources, automatic site updates, and other features gated behind a commercial license. (same pricing data, https://digpangolin.com/pricing)

### Verdict

Strongest single option for **both** (a) and (b) at zero incremental SaaS cost when self-hosted: outbound-only tunnel (no router ports), full flexible use of `lab53.net` via a wildcard record, and browser-rendered SSH/RDP/VNC for clientless internal access. Trade-off: you operate the VPS + Pangolin/Newt/Traefik/Gerbil stack yourself (comparable operational burden to self-hosted NetBird).

---

## Cloudflare Tunnel / Cloudflare One (Zero Trust)

Primary sources: [Cloudflare Tunnel overview](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/), [DNS records for a tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/), [Replace your VPN — Device to network](https://developers.cloudflare.com/cloudflare-one/setup/replace-vpn/device-to-network/), [Private networks](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/private-net/), [Browser-rendered terminal](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/browser-rendering/), [Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/).

### How it works

- `cloudflared` runs as a lightweight daemon on your infrastructure and creates **outbound-only** connections to Cloudflare's network — no inbound listener, no router port-forward, and Authenticated Origin Pulls/firewall rules are irrelevant since there's nothing to attack inbound. ([Tunnel overview](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/))
- **Publishing a public hostname (a)**: each tunnel gets a Cloudflare-generated `<UUID>.cfargotunnel.com` subdomain; you add a normal **CNAME** record at your own domain (already on Cloudflare or delegated to it) pointing to it — e.g. `service.lab53.net CNAME <uuid>.cfargotunnel.com`. This works with **any hostname on any domain you control in that Cloudflare account**, fully satisfying "use `lab53.net` flexibly." ([DNS records](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/))
- **Reaching the internal network (b)** — two complementary mechanisms:
  - *Device to network*: install `cloudflared` on one box inside the home network, define its private IP range (e.g. `10.0.1.0/24`) as a tunnel route, then install the **Cloudflare One Client** (their WARP-based agent) on each remote device and enroll it in your Zero Trust org — this still means installing a client on every connecting device, just not raw WireGuard/manual certs (SSO-based enrollment instead). ([Device to network](https://developers.cloudflare.com/cloudflare-one/setup/replace-vpn/device-to-network/))
  - *Browser-rendered terminal*: for specific SSH, RDP, or VNC applications published as **self-hosted public applications** (i.e. via a Tunnel + Access application, not a raw private IP), Cloudflare can render the full session **directly in the browser with no client software and no end-user configuration** — a true zero-install path for reaching specific internal hosts. Limitation: only works for resources published as public Access applications, not arbitrary private IPs/hostnames. ([Browser-rendered terminal](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/non-http/browser-rendering/))

### Pricing

- Cloudflare's account-limits doc explicitly names a **"Zero Trust Free"** tier distinct from Standard/Enterprise (used to scope DEX test/remote-capture limits), confirming a free tier of Cloudflare One/Zero Trust exists as a first-class plan. ([Account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/))
- Cloudflare's own marketing pricing page for Zero Trust Services is client-side-rendered and did not yield a scrapable literal number for the free-tier seat cap in this pass — verify the current seat count directly at <https://www.cloudflare.com/plans/zero-trust-services/> before committing, but every account-limits value confirms a Free plan is a supported, current, paid-parallel tier for Tunnel/Access/Gateway, and Cloudflare Tunnel itself (`cloudflared`, DNS routing, CNAME) requires no Zero Trust seat at all to publish a public hostname — seats are only consumed for **Access-protected**/enrolled-device use.
- Domain requirement: your zone (`lab53.net`) needs to be on Cloudflare (as DNS host or at minimum with Cloudflare-manageable DNS) to create the CNAME to `cfargotunnel.com` — a one-time nameserver change, not per-service configuration.

### Verdict

The most flexible option for (a) — plain CNAME at any subdomain of `lab53.net`, zero incremental cost, well-documented, widely used. For (b), best available *fully clientless* option (browser-rendered SSH/RDP/VNC) for specific hosts; full transparent LAN access still needs the Cloudflare One Client on the remote device (SSO-based, not manual WireGuard config).

---

## Other options considered

- **rathole / frp / chisel** (self-hosted TCP/HTTP tunnel daemons): conceptually similar to Cloudflare Tunnel's outbound-only model but require you to operate the public-facing relay server yourself (a VPS with open ports) and provide none of the identity-aware access control, browser rendering, or DNS automation the above tools include out of the box. Not surveyed in further depth since Pangolin already packages this pattern with a maintained UI, auth, and DNS story, and Cloudflare provides it as a managed free service. Skipped for primary-source depth given time-box; flag if the team wants a from-scratch/self-hosted-only comparison.
- **ngrok**: primarily aimed at ephemeral dev tunnels; its persistent/custom-domain features are behind paid plans and it's a narrower single-purpose tool than Cloudflare Tunnel or Pangolin. Not deep-dived given Cloudflare Tunnel already covers the same use case for free with a real custom domain.
- **Headscale** (open-source Tailscale control-plane reimplementation): would remove Tailscale's `*.ts.net`-only restriction being enforced by Tailscale's own coordination server, but Headscale does not reimplement Funnel's public relay, and it's an unofficial, community-maintained reimplementation of a proprietary control plane — higher operational/compatibility risk than the vendor-native options above. Not selected as a primary recommendation given Pangolin/Cloudflare already meet the domain-flexibility requirement natively.

---

## Recommendation

Given the constraints (free-first, no router ports, flexible use of `lab53.net`, single operator):

1. **For (a) — `service.lab53.net` reachable from anywhere:** use **Cloudflare Tunnel**. It's free, requires no Zero Trust seats for plain public-hostname publishing, uses a normal CNAME so any `*.lab53.net` hostname works, and needs nothing more than `cloudflared` running somewhere with outbound internet — no router changes at all.
2. **For (b) — reaching the internal-only network without installing VPN clients everywhere:** use **Cloudflare's browser-rendered SSH/RDP/VNC** (via Access applications on the same Tunnel) for the specific internal hosts you need to reach opportunistically from an untrusted/borrowed device, and layer the **Cloudflare One Client** (SSO-enrolled, not a manual WireGuard cert) on your own regularly-used devices for full private-network reach. This reuses the same `cloudflared` tunnel already deployed for (a), avoiding a second product/vendor.
3. **Runner-up worth prototyping in parallel:** self-hosted **Pangolin** on a small VPS. It is the only option that natively unifies both (a) and (b) in one product (outbound tunnel + wildcard `lab53.net` + browser-rendered SSH/RDP/VNC + optional native clients), at zero SaaS cost — the cost is operating one more small piece of infrastructure (a VPS + the Pangolin/Newt/Traefik/Gerbil stack) versus depending entirely on Cloudflare's managed service.
4. **NetBird** is the best *pure VPN-replacement* if browser-based SSH/RDP access to a few boxes is the main "reach-in" need and a public-facing `lab53.net` hostname isn't required for that particular resource — its free cloud tier (5 users/100 machines) or a lightweight self-hosted 0.62+ deployment are both viable, but it has no answer for requirement (a) at all.
5. **Tailscale** is the easiest to set up and has the best free tier for pure device-to-device/subnet-router VPN use, but its hard `*.ts.net`-only domain restriction rules it out for requirement (a), and it offers no clientless/browser path for (b) — making it the weakest fit for this ticket's specific domain-flexibility requirement, despite being excellent in isolation as "just a VPN."

**Suggested next step:** stand up Cloudflare Tunnel first (lowest effort, satisfies both halves adequately, zero new infrastructure), and open a follow-up spike ticket to prototype self-hosted Pangolin if deeper control (own domain DNS, no third-party dependency for the tunnel relay) becomes a priority later.
