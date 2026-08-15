# Research: revisit TrueNAS declarative options + single-tool feasibility

Ticket: [#34](https://github.com/aaronkyriesenbach/catalyst/issues/34) (part of the "Homelab platform
rearchitecture" wayfinder map, [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)). Follows up on
[#2](https://github.com/aaronkyriesenbach/catalyst/issues/2) / `docs/research/iac-bootstrap-research.md`.

## Question

The original survey (#2) found no live Terraform/OpenTofu provider for TrueNAS SCALE and recommended
Ansible for it specifically, landing on a 3-way tool split (OpenTofu for Proxmox+Unifi, Ansible for
TrueNAS). The requester has since found TrueNAS Terraform/OpenTofu providers not covered by that
research via a quick web search, and would prefer a single tool across all three targets (Proxmox,
TrueNAS, Unifi) if genuinely feasible.

This re-surveys TrueNAS SCALE declarative/IaC options in depth and explicitly assesses single-tool
feasibility (Ansible-only vs. OpenTofu-only) across Proxmox + TrueNAS + Unifi.

---

## 1. TrueNAS Terraform/OpenTofu provider re-survey

`dariusbakunas/terraform-provider-truenas`, the provider #2 found, remains **archived** (last push
2025-10-02, per GitHub repo metadata) — no change there. But the ecosystem has grown substantially
since #2's research: a GitHub search for `terraform-provider-truenas` returns 14 repositories, and a
broader search (`truenas terraform`, in name/description) returns 23. Filtering to non-fork, non-archived,
**published-on-a-provider-registry** results narrows this to six real candidates:

| Provider              | Registry downloads | Latest version | Published    | License                    | Architecture              |
| --------------------- | ------------------ | -------------- | ------------ | -------------------------- | ------------------------- |
| `bmanojlovic/truenas` | 12,502             | 0.0.40         | 2026-07-13   | **none** (no LICENSE file) | Native JSON-RPC/WebSocket |
| `deevus/truenas`      | 9,517              | 0.16.0         | 2026-04-19   | MIT                        | SSH + `midclt` shell-out  |
| `barodeur/truenas`    | 3,558              | 0.3.0          | 2026-02-27   | none                       | Native JSON-RPC/WebSocket |
| `baladithyab/truenas` | 3,299              | 0.2.25         | 2025-11-19   | NOASSERTION                | REST (24.04 only)         |
| `xonvanetta/truenas`  | 2,925              | 0.0.1          | 2021 (stale) | —                          | Legacy REST               |
| `dev-dull/trueform`   | 2,459              | 0.2.6          | 2026-06-24   | MIT                        | Native JSON-RPC/WebSocket |
| `PjSalty/truenas`     | 1,455              | 2.4.1          | 2026-07-27   | MPL-2.0                    | Native JSON-RPC/WebSocket |

Source: Terraform Registry API (`https://registry.terraform.io/v1/providers/<ns>/truenas`), GitHub repo
metadata API. All six are also indexed on the **OpenTofu Registry mirror**
(`https://registry.opentofu.org/v1/providers/<ns>/truenas/versions` returns valid version/protocol data
for `PjSalty`, `deevus`, and `bmanojlovic`) — protocol version 6.0 (terraform-plugin-framework) for
`PjSalty`/`deevus`/`dev-dull`, 5.0 (older SDK) for `bmanojlovic`. Terraform and OpenTofu providers are
the same distributable artifact (both consume the Terraform Registry provider protocol), so nothing
here is Terraform-only or OpenTofu-only.

### 1.1 `xonvanetta/truenas` and `baladithyab/truenas` — ruled out

- `xonvanetta/truenas`: unchanged from #2's finding — last touched 2021, pre-dates the JSON-RPC API
  migration entirely.
- `baladithyab/terraform-provider-truenas`: explicitly scoped to **TrueNAS SCALE 24.04 only**, with its
  own README stating "❌ TrueNAS Scale 25.x NOT SUPPORTED: Version 25.x switched to JSON-RPC over
  WebSocket and is incompatible with this provider." This directly confirms #2's premise (REST → JSON-RPC
  break) rather than contradicting it — it's a REST-era provider deliberately staying off 25.x, not a
  live option for current TrueNAS. Source: raw README,
  `github.com/baladithyab/terraform-provider-truenas`.

### 1.2 `bmanojlovic/truenas` — broadest coverage, but real design/legal concerns

- Auto-generated from the TrueNAS JSON-RPC API schema: **183 resources, 67 data sources** in
  `docs/resources/` and `docs/data-sources/` (tree listing via GitHub API) — by far the widest surface
  of any candidate, covering pools, datasets, VMs, iSCSI, NVMe-oF, apps, users/groups, replication, etc.
- **No LICENSE file in the repository** (GitHub's license API returns nothing) — a real adoption blocker;
  copyright/redistribution terms are unstated.
- Single maintainer (`bmanojlovic`: 47 of 47 fetched commits; no other contributors), 31 releases
  2026-01-08 → 2026-07-13, 11 GitHub stars, 0 open issues.
- **A large fraction of the "resources" model one-shot RPC actions, not persistent state** — e.g.
  `truenas_action_vm_start`, `truenas_action_pool_scrub`, `truenas_action_config_save` — roughly 110 of
  the 183 resource docs are `action_*`. The provider's own generated docs are explicit about the
  consequence: _"This is an action resource that executes the `vm.start` operation. Actions are
  triggered on resource creation and cannot be undone on destroy."_ Modeling imperative RPC calls as
  Terraform resources fights the tool's core create/read/update/delete-against-desired-state model (a
  `terraform destroy` on an action resource can't literally undo "start the VM") and is a real maturity
  smell independent of raw resource count. Source: raw docs
  `github.com/bmanojlovic/terraform-provider-truenas/docs/resources/action_vm_start.md`.
- **Conclusion:** widest raw coverage of the field, but the missing license and the action-as-resource
  pattern make it hard to recommend as-is; the genuinely CRUD-modeled resources within it (pool, dataset,
  user, group, cronjob, etc.) are usable in principle, but you'd need to avoid the `action_*` family and
  resolve the licensing question with the author first.

### 1.3 `PjSalty/truenas` — strongest candidate found

- Targets the JSON-RPC 2.0 WebSocket API directly (`/api/current`), API-key auth, MPL-2.0 licensed (the
  same license family OpenTofu itself uses).
- **64 resources / 33 data sources**, organized by domain (storage, sharing, networking, virtualization,
  identity & access, data protection) and modeled as real persistent config — datasets, snapshot/scrub
  tasks, shares, iSCSI, VMs, users, directory services — no action-as-resource anti-pattern.
- **Explicit version-compatibility matrix**, validated against live instances per release line:

  > "v2.0 is validated against live instances of each line: **SCALE 25.10**, fully supported; the
  > complete acceptance suite passes (147/147). **SCALE 25.04**, works for the common surface (126/141)...
  > **SCALE 26.0-BETA**, 143/147; the four failures are 26.0 API drift."

  Source: `README.md`, "Version Compatibility" section.

- **Built-in safety rails aimed at exactly this repo's bootstrapping scenario** — `read_only` (blocks
  every mutating JSON-RPC call before it reaches the wire) and `destroy_protection` (blocks only
  `DELETE`), plus a committed `examples/prod-smoke/` workspace and a phased-rollout runbook
  (`docs/guides/phased-rollout.md`) for the "first `terraform apply` against real production TrueNAS"
  moment.
- **Test depth**: 401 files matching `_test.go` in the tree (unit + acceptance tests per resource), CI
  (`ci.yml`) plus a dedicated CodeQL security-scanning workflow (`codeql.yml`).
- **Active, real issue tracker** — of the last several issues, two are open and explicitly about
  upcoming TrueNAS API changes the maintainer is tracking ahead of time: `#29` "auth: the legacy
  handshake is still the default path, and it is removed in TrueNAS 27", `#28`/`#27` "TrueNAS 26 blocker"
  issues for `smb.enable_smb1`/`service.start`-`stop` API removals. Several bug reports (`#16`–`#21`)
  have already been fixed and closed (pool creation with SCSI disks, directory permission drift, SGID
  bit, multi-group users). This is exactly the kind of upstream-API-churn tracking whose _absence_ is
  what killed `dariusbakunas` in #2's research — here it's visibly happening.
- **Residual risk**: created 2026-04-25 (~4 months old at research time), effectively a single primary
  maintainer (186 of the fetched commits vs. 3 from `dependabot[bot]` and 2 from one other contributor),
  and a small install base (1,455 registry downloads — far below `bpg/proxmox`'s or `filipowm/unifi`'s).
  Real bus-factor risk; nothing here makes it bulletproof, just credible.
- Source: `github.com/PjSalty/terraform-provider-truenas` (README, releases, issues, contributors, git
  tree), `registry.terraform.io/v1/providers/PjSalty/truenas`,
  `registry.opentofu.org/v1/providers/PjSalty/truenas/versions`.

### 1.4 `deevus/truenas` — different architecture, also credible

- Talks to TrueNAS over **SSH**, shelling out to `midclt` (TrueNAS's own first-party JSON-RPC CLI client)
  rather than speaking the WebSocket protocol directly. This is a legitimate alternative — it rides on
  TrueNAS's own maintained client instead of reimplementing the wire protocol — but it's a materially
  different operational/security model: it needs SSH key distribution and a system user permissioned for
  `midclt`, `rm`, and `rmdir`, versus a plain API-key/HTTPS-WSS setup.
- 13 resources / 5 data sources (dataset, zvol, snapshot, app, VM, cloudsync, host_path, file) — narrower
  than `PjSalty` but covers **apps and VMs**, which `PjSalty` also covers but `barodeur`/`dev-dull` don't
  fully.
- MIT licensed, 21 releases (v0.1.0 → v0.16.0, 2026-01-11 → 2026-04-20), **4 contributors** (vs. 1 for
  most others here) — the best bus-factor signal of the new candidates. Has a "Commercial Support" badge
  linking to the maintainer's consultancy — a mild positive signal (skin in the game) but also means some
  incentives could tilt toward paid support over time; noted neutrally.
- Source: `github.com/deevus/terraform-provider-truenas` (README, releases, contributors).

### 1.5 `barodeur/truenas` and `dev-dull/trueform` — smaller, newer, single-maintainer

- `barodeur/truenas`: native JSON-RPC, 24 resources (heavy iSCSI/NVMe-oF coverage, users/groups, shares,
  cronjobs), 3 releases, single maintainer, created 2026-02-07 — real but the youngest/thinnest release
  history of the field.
- `dev-dull/trueform`: native JSON-RPC, 18 resources (VM, docker app, shares, iSCSI, certs), single
  maintainer, MIT licensed. Notable for candor — its own README states: _"There didn't appear to be any
  published Terraform providers for TrueNAS Scale for versions 25 and greater... so I decided to burn my
  Claude Code trial by generating one. It has been mostly written by Claude Code."_ Worth taking at face
  value: a self-described AI-generated experiment, useful as a signal that this space is being actively
  worked on from multiple angles, but not a primary recommendation on its own admission.

### 1.6 Conclusion for TrueNAS

**The original research's central finding — "no live Terraform/OpenTofu provider for TrueNAS SCALE" — no
longer holds.** `PjSalty/terraform-provider-truenas` is a genuinely credible, actively maintained,
native-JSON-RPC provider targeting the current API, with test depth, safety rails, and forward-looking
maintenance that specifically anticipates the same kind of API churn that killed the prior generation of
providers. It is young and effectively single-maintainer, so real risk remains, but "credible" is now the
right word where #2 correctly said "not viable."

---

## 2. Unifi Ansible re-survey

# 2 found no comparable Ansible collection for Unifi. Re-checking Ansible Galaxy (`keywords=unifi`) turns

up 14 collections; almost all are roles that _deploy the UniFi Network Controller software itself_ in
Docker/Podman (`uumas.docker`, `brianreumere.software`, `finallycoffee.services`, `danmwallace.docker`,
`triplepoint.dockerized_services`, `mrbrandao.server`, `fansilet.homelab`, `vmutti.unifi`) or are
read-only facts modules (`crytectobi.unifi`) — none of those manage the _network configuration_ itself.
Two do:

### 2.1 `hellqvio86.unifi`

- 17 modules covering WLAN, port profiles, switch profiles/assignment, firewall policy/zone/group, NAT
  rules, port forwarding, DHCP server/reservations, rsyslog, SSH keys, SSL/user certs, system settings —
  the broadest real config-management surface found for Unifi in either ecosystem.
- Explicitly marked **"Alpha Status... APIs and module arguments are subject to breaking changes"** by
  its own README.
- Authenticates via **username/password + session cookie/CSRF token against the controller's legacy
  private REST surface** (`/api/s/{site}/rest/...`) — the same reverse-engineered, undocumented API that
  `paultyng/unifi` and its forks use, not Ubiquiti's newer official API (see 2.3). Confirmed by reading
  `plugins/module_utils/unifi_api.py`.
- Single maintainer (104 of 112 fetched commits; 8 from `dependabot[bot]`), 1 GitHub star, MIT licensed,
  created 2026-04-26 (~4 months old at research time), 13 releases. No dedicated network/VLAN-creation
  module (`unifi_wlan` manages wireless SSIDs; port/switch profiles reference networks by name but don't
  create them) — a real coverage gap for VLAN provisioning specifically.
- Source: `github.com/hellqvio86/ansible-collection-unifi` (README, `plugins/modules/` tree,
  `module_utils/unifi_api.py`).

### 2.2 `kenmoini.unifi_network`

- Uses Ubiquiti's newer **official, API-key-authenticated "UniFi Network Integration API"** — confirmed
  via `plugins/module_utils/auth.py`, which requires `unifi_network_api_key` (not username/password).
- Mostly **read-only `_info` modules** (~30 of them: clients, devices, ACL rules, DPI, firewall zones,
  hotspot vouchers, VPN servers, WAN interfaces, WiFi broadcasts). Only one true state-managing resource
  module — `network` ("Manages the state of a Network") — plus a few one-shot action modules
  (`adopt_device`, `device_action`, `port_action`).
- Lives in a longer-running multi-collection monorepo (`github.com/kenmoini/ansible-collections`, created
  2023, 3 stars, pushed 2026-08-04), so more established as a repo, but thin for actual config
  management — good for inventory/read tasks, not a general Unifi IaC tool on its own.
- Source: `registry` metadata via Galaxy API, `github.com/kenmoini/ansible-collections`.

### 2.3 The official UniFi Network Integration API — a relevant emerging signal

Independent of either collection, Ubiquiti now documents an official **"UniFi Network Integration API"**
(OpenAPI-based, API-key auth, endpoint shape `/v1/sites/{siteId}/...`) at `developer.ui.com` — the same
API `kenmoini.unifi_network` targets. Corroborating evidence that this is a real, separate, more stable
surface from the legacy private controller API:

- A brand-new (and not yet usable) Terraform provider, **`beezly/terraform-provider-unifi-ng`**, states
  its whole reason for existing is that "[e]xisting providers (`paultyng/unifi`, `ubiquiti-community/unifi`)
  use the legacy `/api/s/{site}/rest/` API. This API has become increasingly unreliable on newer UniFi OS
  firmware (5.x+)... This provider uses the new Integration API... which: Supports API key
  authentication... Is officially documented via OpenAPI specs... Is more stable across firmware
  versions." It is **not published to any provider registry** and its own README says "🚧 Work in
  progress — schema generation is working, HTTP CRUD implementations in progress" (0 stars, created
  2026-03-08, last pushed same day) — not usable today, but a directional signal.
- Other independent tooling references the same official API: a Pulumi provider
  (`mcurcio/pulumi-unifi`, "generated from the official UniFi Network Integration API (OpenAPI)") and an
  MCP server (`jmpijll/unifi-code-mode-mcp`, "for the UniFi Network Integration API and Site Manager
  API").

**Net for Unifi:** today's best-maintained tooling on both sides (`filipowm/unifi` for Terraform,
`hellqvio86.unifi` for Ansible) still targets the legacy, reverse-engineered private controller API — the
ecosystem is visibly starting to shift toward the official Integration API (`kenmoini`'s collection,
`beezly`'s WIP provider, the Pulumi/MCP tools), but nothing built on the new API is mature enough to
recommend switching to yet.

---

## 3. Single-tool feasibility assessment

### 3.1 Can Ansible alone cover Proxmox + TrueNAS + Unifi at acceptable quality?

- **Proxmox**: yes — `community.proxmox` is unchanged from #2, still actively maintained (140 stars,
  pushed 2026-08-12), broad coverage. No change to this leg.
- **TrueNAS**: mostly yes — `arensb.truenas` remains active (109 stars, latest release 2026-05-10,
  v2.0.3) and does cover the core storage-layer use case: its `filesystem` module manages ZFS
  datasets/zvols directly against the middleware API (despite the generic name), plus NFS/SMB/WebDAV
  shares, users/groups, certificates, snapshot/scrub tasks, jails. It does **not** cover VM/app/iSCSI/
  network-interface management, which several of the new Terraform providers (`PjSalty`, `deevus`) do —
  a real gap depending on how much of TrueNAS's surface this repo actually needs.
- **Unifi**: the weak link. Two collections now exist where #2 found none, but neither is "acceptable
  quality" out of the box: `hellqvio86.unifi` has the coverage but is explicitly alpha, single-maintainer,
  four months old, and built on the fragile legacy private API; `kenmoini.unifi_network` is built on the
  stable official API but only manages one resource type (networks) plus a couple of action modules —
  everything else is read-only. **The fallback the question asks about — hand-rolled
  `ansible.builtin.uri` tasks against the official, documented, API-key-authenticated Integration API —
  is genuinely viable from an API-stability standpoint**, since that API is real and documented (section
  2.3), but it shifts all idempotency/diffing logic onto the operator: `uri` has no built-in
  "compare desired vs. actual, only PATCH the delta" behavior the way a proper module does, so every
  resource type needs its own hand-written check-then-act logic — materially more work than either
  Terraform's plan/apply model or a real Ansible module gives you for free.

**Verdict: Ansible-alone is not solidly credible today, specifically because of Unifi.** Proxmox and
TrueNAS are both fine; Unifi's Ansible options are either too immature or too narrow, and the
`ansible.builtin.uri` escape hatch, while technically sound against a real API, trades collection-immaturity
risk for hand-rolled-idempotency labor — not a clean win.

### 3.2 Can OpenTofu/Terraform alone cover Proxmox + TrueNAS + Unifi at acceptable quality?

- **Proxmox**: yes, unchanged — `bpg/proxmox` remains the strongest of any provider surveyed across
  either tool (2,179 stars, pushed 2026-08-15, PVE-version-tracked).
- **TrueNAS**: now **yes, with a caveat** — `PjSalty/terraform-provider-truenas` (section 1.3) targets
  the current JSON-RPC API natively, is tested and CI'd more rigorously than any other candidate found in
  either ecosystem (Terraform or Ansible), has explicit per-TrueNAS-version compatibility validation, and
  is actively tracking upcoming TrueNAS 26/27 breaking changes before they land. It is young and
  effectively single-maintainer, so this is "credible today," not "risk-free."
- **Unifi**: yes, unchanged from #2 — `filipowm/unifi` is still the most active fork (61 stars, pushed
  2026-08-10, 432,962 registry downloads), still carries the same fork-abandonment risk #2 already flagged
  (its lineage has already died once), and is still built on the legacy private API rather than the
  emerging official one (section 2.3).

**Verdict: OpenTofu-alone across all three is now credible.** This is the one conclusion that has
materially changed since #2: the single blocker that forced the 3-way split — "no live TrueNAS
provider" — is resolved by `PjSalty/truenas`. The residual risk is entirely in maintainer bus-factor
(both `PjSalty/truenas` and, to a lesser extent, `filipowm/unifi` are exposed to a single or small
number of maintainers going quiet), not in API-compatibility or tooling-model fit.

---

## 4. Recommendation

Switch from the hybrid to a **single-tool OpenTofu setup**: `bpg/proxmox` (Proxmox) + `PjSalty/truenas`
(TrueNAS) + `filipowm/unifi` (Unifi), all with git-committed, natively-encrypted local state as #2
already established for the chicken-and-egg state problem — nothing about that mechanism changes here.

This is credible today, not risk-free — pin exact provider versions, and treat both `PjSalty/truenas`
(4 months old, effectively single-maintainer) and `filipowm/unifi` (proven fork-abandonment risk in its
own lineage) as the two components most likely to need re-evaluation or a self-maintained fork later.
Concretely: pin `required_providers` to an exact version rather than a range for these two, and revisit
this choice in a few months once `PjSalty/truenas`'s TrueNAS 26 support (currently tracked in open
upstream issues) lands and its install base has had more time to prove out.

If that residual bus-factor risk is unacceptable, the fallback isn't Ansible-alone — Ansible's Unifi
story is the weaker leg of _that_ tool, not the stronger one — it's keeping #2's original hybrid
(Ansible/`arensb.truenas` for TrueNAS) a while longer and re-running this survey again once `PjSalty/truenas`
has more history behind it.

---

## Sources

- `dariusbakunas/terraform-provider-truenas` (archived): <https://github.com/dariusbakunas/terraform-provider-truenas>
- `bmanojlovic/terraform-provider-truenas`: <https://github.com/bmanojlovic/terraform-provider-truenas> ,
  <https://registry.terraform.io/v1/providers/bmanojlovic/truenas>
- `deevus/terraform-provider-truenas`: <https://github.com/deevus/terraform-provider-truenas> ,
  <https://registry.terraform.io/v1/providers/deevus/truenas>
- `PjSalty/terraform-provider-truenas`: <https://github.com/PjSalty/terraform-provider-truenas> ,
  <https://registry.terraform.io/v1/providers/PjSalty/truenas> ,
  <https://registry.opentofu.org/v1/providers/PjSalty/truenas/versions>
- `barodeur/terraform-provider-truenas`: <https://github.com/barodeur/terraform-provider-truenas>
- `dev-dull/terraform-provider-trueform`: <https://github.com/dev-dull/terraform-provider-trueform>
- `baladithyab/terraform-provider-truenas`: <https://github.com/baladithyab/terraform-provider-truenas>
- `xonvanetta/terraform-provider-truenas`: <https://github.com/xonvanetta/terraform-provider-truenas>
- TrueNAS API docs (JSON-RPC/WebSocket versions confirmed 25.04, 25.10): <https://api.truenas.com/>
- `hellqvio86.unifi` (Ansible): <https://github.com/hellqvio86/ansible-collection-unifi>
- `kenmoini.unifi_network` (Ansible): <https://github.com/kenmoini/ansible-collections> ,
  Galaxy metadata `https://galaxy.ansible.com/api/v3/plugin/ansible/content/published/collections/index/kenmoini/unifi_network/`
- `crytectobi.unifi`, `vmutti.unifi`, and other Unifi-tagged Galaxy collections (deployment roles /
  facts-only, not config management): Galaxy search
  `https://galaxy.ansible.com/api/v3/plugin/ansible/search/collection-versions/?keywords=unifi`
- `beezly/terraform-provider-unifi-ng` (WIP, official Integration API): <https://github.com/beezly/terraform-provider-unifi-ng>
- `filipowm/terraform-provider-unifi`: <https://github.com/filipowm/terraform-provider-unifi> ,
  <https://registry.terraform.io/v1/providers/filipowm/unifi>
- `arensb/ansible-truenas`: <https://github.com/arensb/ansible-truenas>
- `community.proxmox` (Ansible): <https://github.com/ansible-collections/community.proxmox>
- `bpg/proxmox` (Terraform/OpenTofu): <https://github.com/bpg/terraform-provider-proxmox>
- Prior research this revisits: `docs/research/iac-bootstrap-research.md` (issue #2)
