# Research: declarative bootstrap options for Proxmox / TrueNAS / Unifi

Ticket: [#2](https://github.com/aaronkyriesenbach/catalyst/issues/2) (part of the "Homelab platform
rearchitecture" wayfinder map, [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

## Question

Before any Kubernetes cluster exists, what's the best way to declaratively/GitOps-manage the
physical layer — Proxmox VE (2 nodes today, growing), TrueNAS SCALE, and the Unifi router config?
For each option: how does it solve the chicken-and-egg state-storage problem, how does it detect
day-2 drift, and how much is free/self-hosted vs. cloud-dependent?

## Constraints considered

- Single operator — no need for multi-user locking/collaboration features.
- Free-tier-first, but a small recurring cost is fine with justification.
- 2 Proxmox nodes today, will grow and eventually be replaced with newer hardware.
- Domain `lab53.net` fixed. Unifi router hardware fixed; its config/software isn't.
- The repo (`catalyst`) already models the Kubernetes layer as **rendered YAML from TypeScript**,
  not Terraform/Helm — worth keeping in mind when judging "idiomatic fit."

---

## 1. Terraform / OpenTofu — provider survey

### 1.1 Proxmox VE

- **`bpg/proxmox`** (Terraform Registry / OpenTofu Registry) is the actively maintained provider,
  a fork of the abandoned `danitso/terraform-provider-proxmox`. It targets PVE 9.x as its primary
  compatibility target (8.x supported but not prioritized, 7.x explicitly unsupported), requires
  Terraform 1.5+/OpenTofu 1.6+, and documents both API-token and SSH-based access (SSH is needed
  for some operations like file uploads).
  Source: https://github.com/bpg/terraform-provider-proxmox (README, "Compatibility Promise" and
  "Requirements" sections), registry listing at
  https://registry.terraform.io/providers/bpg/proxmox/latest (13.4M downloads at time of writing,
  current version 0.111.1).
- This is by far the most credible Proxmox provider — actively released, PVE-version-tracked, and
  it explicitly deprecated the old `terraform-provider-proxmox` naming, absorbing its user base.

### 1.2 TrueNAS

- **`dariusbakunas/truenas`** was the most-downloaded TrueNAS Terraform provider (44.4k downloads),
  but its GitHub repo (https://github.com/dariusbakunas/terraform-provider-truenas) is **archived**
  as of query time, with the README stating explicitly:
  > "Archiving this as TrueNAS deprecating REST APIs" (linking to
  > https://github.com/dariusbakunas/terraform-provider-truenas/issues/25).
- This tracks a real platform change: TrueNAS's own docs state "The versioned JSON-RPC 2.0
  Websocket Application Programming Interface (API) was introduced with TrueNAS 25.04," and the
  officially linked client is a Python library (`truenas/api_client` on GitHub), not a REST client.
  Source: https://api.truenas.com/ (TrueNAS API docs landing page) and
  https://api.truenas.com/25.04/.
- **`xonvanetta/truenas`** is a smaller, low-download (2.9k) alternative, last pushed 2021 — also
  stale and pre-dating the API migration.
- **Conclusion: there is currently no actively maintained Terraform/OpenTofu provider for TrueNAS
  SCALE that targets its current (WebSocket/JSON-RPC) API.** Any Terraform-based TrueNAS story
  today means writing/maintaining a custom provider (e.g. wrapping the WebSocket API, or via a
  generic HTTP/REST provider against whatever legacy REST surface remains) — not a drop-in option.

### 1.3 Unifi

- **`paultyng/unifi`**, historically the dominant Unifi provider (4.78M downloads), is now
  **archived**. Its README points to three community forks with no single designated successor:
  `filipowm/unifi`, `ubiquiti-community/unifi`, and `akerl/unifi`
  (https://github.com/paultyng/terraform-provider-unifi, issue #461 referenced in the archival
  notice).
- Of these, **`filipowm/unifi`** is the most actively developed (pushed within the last day at
  research time, 60 stars, published to the registry, currently at v1.x with schema changes
  relative to the old `paultyng` v0.41.x lineage — the README calls out state-compatibility
  caveats). It supports UniFi Controller 6.x+, UDM/UDM-Pro/UCG, and covers networks/WLANs,
  firewall rules, port forwarding, DNS records, users, etc. Source:
  https://github.com/filipowm/terraform-provider-unifi (README).
- `ubiquiti-community/unifi` and `akerl/unifi` continue the old v0.41.x schema and are marked
  "drop-in" replacements for `paultyng` state, per the same archival README.
- **Conclusion: Unifi has a viable, if fork-fragmented, Terraform story.** `filipowm/unifi` is the
  most alive option; there's no official Ubiquiti-maintained provider, so this remains
  community-risk (a provider going stale is exactly what already happened to `paultyng/unifi`).

### 1.4 State storage — the chicken-and-egg problem

Terraform/OpenTofu state has to live *somewhere* readable/writable before or independent of the
infra it describes:

- **`local` backend** stores state as a plain file on the machine running `tofu apply`, with
  filesystem-based locking. No external dependency at all — the file can simply be committed to
  the `catalyst` git repo. Source:
  https://github.com/opentofu/opentofu (website/docs/language/settings/backends/local.mdx —
  "The local backend stores state on the local filesystem, locks that state using system APIs...").
- Committing plaintext state to git is normally a bad idea (state can contain secrets), but
  **OpenTofu natively supports state/plan encryption at rest** (`terraform`/`encryption` block,
  with pluggable key providers — PBKDF2 passphrase, AWS/GCP/Azure KMS, external methods, etc.),
  which makes "git-committed, encrypted local state" a legitimate self-hosted, zero-infrastructure
  pattern. Source: OpenTofu docs, website/docs/language/state/encryption.mdx
  ("OpenTofu supports encrypting state and plan files at rest, both for local storage and when
  using a backend").
- Locking with the `local` backend is filesystem-level, which is fine for a **single operator** —
  the multi-writer conflict problem Terraform's locking exists to solve doesn't really apply here.
  Source: OpenTofu docs, website/docs/language/state/locking.mdx.
- Remote backends (S3-compatible, Consul, Kubernetes secrets, `pg` a.k.a. Postgres, HCP
  Terraform/Terraform Cloud "remote" backend) all require something to already exist to host them
  — which is circular for bootstrapping Proxmox itself. HCP Terraform (formerly Terraform Cloud)
  does offer a hosted free tier and manages state/locking for you without any local infra, at the
  cost of a cloud dependency for what is otherwise a fully local homelab. Source:
  https://developer.hashicorp.com/terraform/cloud-docs (product overview) — the pricing/tier
  specifics are on HashiCorp's public pricing page and are not reproduced here since exact figures
  change over time; treat "there is a free tier for small usage" as directional, not contractual.

**Given a single operator**, the `local` backend + OpenTofu's built-in encryption + committing the
(encrypted) state file to the `catalyst` repo is the standard, fully self-hosted answer to the
chicken-and-egg problem — no external state store needs to exist before Proxmox does.

### 1.5 Drift detection

- Neither Terraform nor OpenTofu ships a background drift detector; drift is only surfaced when
  you run `plan` (or `apply -refresh-only`) again and compare against real infrastructure. HCP
  Terraform/Terraform Cloud offers scheduled/continuous drift-detection *runs* as a paid product
  feature; the OSS `local` backend has no equivalent scheduler, so drift detection there means
  "you (or a cron job / CI) run `tofu plan -detailed-exitcode` periodically" — self-hosted, but
  DIY. Source: OpenTofu backend/state docs as above (no dedicated drift-detection doc exists in
  the OSS project beyond periodic plan/apply).

### 1.6 Free/self-hosted vs. cloud

Terraform/OpenTofu itself, all three providers surveyed, and the `local` backend with encryption
are 100% self-hosted and free (OSS, Mozilla/BSL-adjacent licensing aside — OpenTofu specifically
exists as the Linux Foundation's fork to keep an MPL-licensed alternative after Terraform's BSL
relicensing). The only cloud dependency would be opting into HCP Terraform for hosted state/runs,
which is optional, not required.

---

## 2. Ansible

### 2.1 Proxmox

- Ansible's Proxmox modules (`proxmox`, `proxmox_kvm`, `proxmox_vm_info`, etc.) originally shipped
  in `community.general`, but **the Proxmox content has moved to a dedicated `community.proxmox`
  collection**; the old `community.general` module names are redirects marked deprecated pointing
  at `community.proxmox.*` equivalents. Source: Ansible's own module docs, e.g.
  https://docs.ansible.com/ansible/latest/collections/community/general/proxmox_kvm_module.html
  ("This redirect has been deprecated. Please update your tasks to use the new name
  `community.proxmox.proxmox_kvm` instead."). The `community.proxmox` collection
  (https://github.com/ansible-collections/community.proxmox) is active and covers an extensive
  surface: VM/container lifecycle, ACLs, ACME, backups/schedules, Ceph (mon/mgr/mds/osd/pool),
  cluster/firewall/HA-groups, storage, and more.
- This is a solid, actively maintained, community-collection-tier (not "certified"/Red-Hat-owned,
  but broadly used) option for Proxmox.

### 2.2 TrueNAS

- There is no official Ansible collection for TrueNAS. The most credible community option is
  **`arensb/ansible-truenas`** (Ansible Galaxy: `arensb.truenas`; 109 GitHub stars, active commits
  within the last few months at research time), which explicitly targets "the TrueNAS API...to
  control the Middleware Daemon" — i.e. it's built against the same WebSocket/JSON-RPC middleware
  API that TrueNAS's own docs describe, not the deprecated REST surface. Source:
  https://github.com/arensb/ansible-truenas (README) and https://www.truenas.com/docs/api/
  (linked from the collection's README as its API target).
- Several other `ansible-truenas`-named repos exist on GitHub but are low-star, single-maintainer,
  or stale (per GitHub search) — `arensb`'s is the standout in terms of activity and scope.

### 2.3 Unifi

- Ansible has no first-party or widely-adopted Unifi collection comparable to `community.proxmox`
  or `arensb.truenas`; Unifi automation in the Ansible ecosystem is thinner than the Terraform
  ecosystem. (No credible, actively maintained collection surfaced during this research; the
  Terraform provider ecosystem is the stronger fit for Unifi specifically.)

### 2.4 State storage / chicken-and-egg

Ansible is **agentless and stateless by design** — it has no state file at all; it just applies
tasks against live targets over SSH/API each run. This sidesteps the chicken-and-egg state-storage
problem entirely: there's nothing that needs to "exist first" to hold state, because Ansible
doesn't track desired-vs-actual state the way Terraform does. The playbooks themselves (committed
to git) *are* the source of truth for desired configuration; the inventory just needs to know how
to reach Proxmox/TrueNAS/Unifi endpoints, which for a homelab is just IPs/hostnames + credentials
(the latter via `ansible-vault` or an external secret store).

### 2.5 Drift detection

Ansible modules are generally idempotent (each module compares live state to desired args and only
acts on divergence), so running `ansible-playbook --check --diff` periodically (cron, or CI) is
the closest equivalent to `terraform plan` for drift detection — but it's opt-in and per-module
quality-dependent, not a systemic guarantee. There's no built-in scheduler or drift dashboard in
core Ansible (that lives in commercial Ansible Automation Platform / AWX, which is heavier
infrastructure than a single-operator homelab needs).

### 2.6 Free/self-hosted vs. cloud

Fully free and self-hosted: Ansible core, `community.proxmox`, and `arensb.truenas` are all
OSS/Galaxy-distributed and run from any control node (a laptop, a Proxmox VM, cron on a NAS jail,
etc.) with no cloud dependency whatsoever.

---

## 3. Packer + cloud-init image baking

- HashiCorp's own Packer Proxmox plugin (`hashicorp/packer-plugin-proxmox`, actively maintained,
  not archived) builds VM templates directly against the Proxmox API — clone a base ISO/cloud
  image, install/configure via the builder, and produce a template other tooling (Terraform,
  manual clone) can spin up VMs from. Source:
  https://github.com/hashicorp/packer-plugin-proxmox (repo metadata: not archived, active pushes)
  and https://developer.hashicorp.com/packer/integrations/hashicorp/proxmox (official plugin docs).
- This is complementary, not competing, with Terraform/Ansible: Packer's job is producing a golden,
  versioned VM template (e.g. "Debian 12 + cloud-init + baseline packages"); Terraform/OpenTofu
  then declaratively instantiates VMs from that template with per-VM cloud-init user-data
  (network, hostname, SSH keys) supplied via the `bpg/proxmox` provider's cloud-init support.
- **State/chicken-and-egg**: Packer has no persistent state of its own — each build is a one-shot
  process that talks to the Proxmox API and exits; the only artifact is the resulting template,
  which lives on the Proxmox node itself (no external store needed).
- **Drift detection**: none — Packer doesn't run against live infra continuously, only at build
  time. Any drift concept here is "is my template stale relative to the latest OS/patches,"
  addressed by periodically re-running the Packer build (e.g. scheduled in CI), not classic
  infra-drift detection.
- **Free/self-hosted**: fully free and self-hosted; only needs network access to the Proxmox API
  and to whatever package mirrors the image install step uses.

---

## 4. Is a classic IaC tool even the right shape here?

Arguments **for** a classic declarative tool (Terraform/OpenTofu, possibly + Ansible for
configuration-inside-the-VM concerns):

- Proxmox and Unifi both have credible, actively maintained OpenTofu providers today
  (`bpg/proxmox`, `filipowm/unifi`), so the "plan/apply against a declarative desired state" model
  is directly usable for at least 2 of the 3 targets.
- OpenTofu's native state encryption removes the historical objection to committing state to git
  for a single-operator setup — the chicken-and-egg problem genuinely has a clean, free,
  self-hosted answer now (source: OpenTofu encryption docs, cited above).
- This repo (`catalyst`) already treats "typed config -> rendered manifests, checked into git" as
  its idiom for the Kubernetes layer; a Terraform/OpenTofu directory alongside it (or a sibling
  repo) that renders the physical layer is a very small conceptual jump for the same operator.

Arguments **against** / reasons to hesitate:

- **TrueNAS has no live IaC story.** The one credible Terraform provider archived itself precisely
  because TrueNAS moved off REST to a WebSocket/JSON-RPC API
  (https://github.com/dariusbakunas/terraform-provider-truenas, README). Forcing Terraform onto
  TrueNAS today means adopting/maintaining a custom provider against a middleware API that is
  still evolving (JSON-RPC API only introduced in 25.04 per TrueNAS's own docs) — real
  maintenance risk for a single operator, for the *one* system (shared storage) you can least
  afford to get subtly wrong.
- **Unifi's ecosystem has already burned an operator once** — the dominant, decade-old provider
  (`paultyng/unifi`, 4.78M downloads) was archived and its userbase forked three ways with an
  explicit state-schema break in at least one fork. Betting the router config on any single
  community Terraform provider carries real fork-abandonment risk; Ubiquiti has never offered an
  official provider.
- Two of three targets (TrueNAS, Unifi) are also just... small surface areas for a homelab of this
  size (2 Proxmox nodes, one NAS, one router). The overhead of learning/maintaining Terraform
  state semantics, provider version pinning, and HCL for systems that change rarely may exceed the
  benefit versus simpler mechanisms.
- Proxmox itself already has a **built-in, zero-additional-tooling mechanism for keeping
  cluster-wide config consistent and versioned across nodes**: `/etc/pve` is not a plain
  directory but `pmxcfs`, "a database-driven file system" that Proxmox VE clusters use for storing
  configuration, transparently replicated to every cluster member via corosync. Source:
  https://pve.proxmox.com/pve-docs/chapter-pvecm.html (Proxmox VE Cluster Manager docs). This
  doesn't give you git history or a diffable desired-state file, but it does mean "config existing
  only on one node" and "config drifting between nodes" are largely non-problems Proxmox already
  solved at the cluster-filesystem level — reducing how much Terraform/Ansible actually needs to
  fight for on the Proxmox side specifically (mostly VM/container lifecycle + host-level settings,
  not cross-node config sync).

**A hybrid, not a single tool, is the right shape:**

1. **Proxmox**: OpenTofu (`bpg/proxmox`) for declarative VM/container lifecycle (this is the part
   that actually benefits from plan/apply — creating/resizing/destroying VMs as the cluster
   grows), state as a git-committed encrypted local file. Packer (`hashicorp/packer-plugin-proxmox`)
   for baking the base VM template(s) that OpenTofu clones from.
2. **TrueNAS**: Ansible (`arensb.truenas`) rather than Terraform — it targets the current API,
   has no state-file circularity to solve, and idempotent playbooks are a reasonable substitute
   for plan/apply given TrueNAS config changes rarely and the collection's module surface is what
   exists today. Treat this as configuration-management, not full IaC, and re-evaluate if/when an
   actively maintained TrueNAS Terraform provider appears.
3. **Unifi**: OpenTofu with `filipowm/unifi` is usable today, but given the fork churn, keep the
   footprint small (networks/VLANs, firewall rules, port-forwards — the things worth having in
   git) and be prepared to re-point `required_providers.source` again if this fork also stalls;
   the migration path the `paultyng` README documents (swap `source`, `terraform init -upgrade`)
   is cheap insurance. Ansible is not a realistic alternative here (no comparable collection
   exists).
4. **Drift detection**, uniformly: periodic `tofu plan -detailed-exitcode` / `ansible-playbook
   --check --diff` runs (cron or CI), not a hosted product — consistent with the free/self-hosted
   constraint and proportionate to a single-operator homelab.

This mirrors `catalyst`'s existing philosophy of "typed, git-committed config that machinery
renders" rather than trying to force one tool to own every system — Terraform/OpenTofu where a
real provider exists and plan/apply adds value (Proxmox lifecycle, Unifi network config), Ansible
where it doesn't (TrueNAS today), and Packer as a narrowly-scoped image-baking step feeding
Terraform, not a competing paradigm.

---

## Sources

- `bpg/proxmox` provider: https://github.com/bpg/terraform-provider-proxmox ,
  https://registry.terraform.io/providers/bpg/proxmox/latest
- `dariusbakunas/terraform-provider-truenas` (archived):
  https://github.com/dariusbakunas/terraform-provider-truenas
- TrueNAS API docs (JSON-RPC/WebSocket, 25.04+): https://api.truenas.com/ , https://api.truenas.com/25.04/
- `paultyng/terraform-provider-unifi` (archived) and fork pointers:
  https://github.com/paultyng/terraform-provider-unifi
- `filipowm/terraform-provider-unifi`: https://github.com/filipowm/terraform-provider-unifi
- OpenTofu backends (`local`): https://github.com/opentofu/opentofu — website/docs/language/settings/backends/local.mdx
- OpenTofu state locking: website/docs/language/state/locking.mdx (same repo)
- OpenTofu state/plan encryption: website/docs/language/state/encryption.mdx (same repo)
- OpenTofu backend configuration overview: website/docs/language/settings/backends/configuration.mdx (same repo)
- HCP Terraform overview: https://developer.hashicorp.com/terraform/cloud-docs
- Ansible `community.proxmox` migration notice:
  https://docs.ansible.com/ansible/latest/collections/community/general/proxmox_kvm_module.html ,
  https://github.com/ansible-collections/community.proxmox
- `arensb/ansible-truenas`: https://github.com/arensb/ansible-truenas
- Packer Proxmox plugin: https://github.com/hashicorp/packer-plugin-proxmox ,
  https://developer.hashicorp.com/packer/integrations/hashicorp/proxmox
- Proxmox cluster filesystem (`pmxcfs`, `/etc/pve`): https://pve.proxmox.com/pve-docs/chapter-pvecm.html

## Recommendation

Use a hybrid, not a single tool: **OpenTofu (`bpg/proxmox`) with git-committed, natively-encrypted
local state** for Proxmox VM/container lifecycle (paired with Packer for template baking),
**Ansible (`arensb.truenas`)** for TrueNAS since no live Terraform provider exists for its current
API, and **OpenTofu (`filipowm/unifi`)** for Unifi with a narrow scope and an eye on fork churn.
Skip hosted state/drift products (HCP Terraform, AAP) — a single operator's needs are covered by
git-committed encrypted state plus a scheduled `plan`/`--check --diff` job.
