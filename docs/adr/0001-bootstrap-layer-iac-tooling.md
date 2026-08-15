# Single-tool OpenTofu for the physical bootstrap layer

Status: accepted

The physical bootstrap layer (Proxmox, TrueNAS, and Unifi — provisioned before any Kubernetes cluster
exists) is managed entirely through **OpenTofu**, rather than splitting across OpenTofu and Ansible:
`bpg/proxmox` for Proxmox, `deevus/truenas` for TrueNAS, `filipowm/unifi` for Unifi. State lives in an
S3 bucket rather than being committed to this (intentionally public) repo. Bootstrap-time credentials
(Proxmox API token, Unifi controller credentials, TrueNAS SSH key) live in AWS Secrets Manager, reusing
the same account already used for in-cluster secrets. Packer bakes the golden VM templates OpenTofu
clones from.

## Considered Options

- **Hybrid split** (OpenTofu for Proxmox+Unifi, Ansible for TrueNAS) — the original recommendation,
  forced by the belief that no live TrueNAS Terraform/OpenTofu provider existed. A deeper resurvey found
  several, reversing that blocker.
- **`PjSalty/terraform-provider-truenas`** for the TrueNAS leg — talks the JSON-RPC API directly, has the
  widest resource coverage found (including iSCSI and network config) and the deepest test suite, but is
  ~4 months old with an effectively single maintainer.
- **`deevus/terraform-provider-truenas`** (chosen) — rides on TrueNAS's own `midclt` CLI over SSH instead
  of reimplementing the wire protocol, has meaningfully better adoption/bus-factor (31 stars / 12 forks /
  4 contributors vs. 8 / 3 / 1), but as of this decision has no iSCSI or network-config resources
  implemented.
- **Git-committed encrypted OpenTofu state** (`local` backend with native state encryption) — ruled out
  because this repo is intentionally kept public and the operator isn't comfortable with encrypted state
  living in a public repo regardless of encryption strength.

## Consequences

- `deevus/truenas` cannot yet manage iSCSI targets/extents or TrueNAS network config, both required by
  this platform. The operator is contributing that support upstream; until it lands, that TrueNAS
  surface is provisioned by some other means and imported/adopted into OpenTofu once the provider gains
  the resources.
- Pin `deevus/truenas` and `filipowm/unifi` to exact versions (not ranges) given their smaller install
  bases, and revisit both in a few months.
- An S3 bucket is now a hard dependency of the bootstrap layer's state storage — reopening, in a small
  way, the "requires a cloud dependency" trade-off the original research raised.
