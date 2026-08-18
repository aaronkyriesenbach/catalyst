# Omni deployment model: single VM, availability risk accepted explicitly

Status: accepted

Keep self-hosted Sidero Omni as a **single-VM deployment** (embedded etcd, the Management host —
see issue #7 and ADR 0002) rather than moving to an externalized-etcd or fully highly-available
topology. This extends issue #7's original tooling choice with an explicit, reasoned availability
call that issue #7 itself didn't spell out — surfaced by [#42](https://github.com/aaronkyriesenbach/catalyst/issues/42)'s
finding that the platform cluster's ArgoCD hub can only reach either workload cluster through Omni's
own WireGuard-tunneled Kubernetes-API proxy (see ADR 0011), making an Omni upgrade or restart a
bigger-looking availability question than it first appeared.

Checked against Sidero's own deployment-model guidance
(`docs.siderolabs.com/omni/self-hosted/options-for-running-omni`) before deciding, since the actual
blast radius of an Omni outage turns out to be narrower than "Omni down" suggests: **Omni is not part
of the Kubernetes control plane**, and Talos clusters use KubePrism plus a discovery service
specifically so that running workloads and each cluster's own internal operation are unaffected by
Omni's availability — _"temporary unavailability does not affect how your clusters run. They
continue operating normally, and Talos machines reconnect when it becomes available again."_ What
Omni gates is **external access only** — _"All external user (e.g., `kubectl`) and service (e.g.,
Infrastructure Providers) communication goes through Omni"_ — which is exactly ArgoCD's situation as
an external reconciler. So the real, accepted risk of a single-VM Omni is: **an extended outage
pauses GitOps reconciliation and any interactive `kubectl`/day-2 access to either workload cluster —
it does not take already-running workloads down.**

Sidero's own recommendation, fully aware of this tradeoff, is a single VM for _"most self-hosted
environments"_ — _"simple and dependable... recommended default for on-prem"_ — citing ~99.9%
achievable uptime from ordinary VM-level practices (snapshots, live migration), and explicitly
steering away from full HA except for teams needing ≈99.99% uptime with dedicated ops capacity. A
fully HA Omni deployment requires roughly 12 servers (Omni, 3 etcd nodes, 2 Image Factory, 2
registry, 2 Vault API, 2 Vault storage, HA auth) and a second, independently-HA'd secrets system
(Vault) — not something that folds into this repo's existing OpenBao — which Sidero itself calls
_"very high complexity... not required for most users."_

For a single-operator homelab, sizing a 12-server HA stack — including a second HA secrets system —
to protect against "GitOps changes wait a few hours" is disproportionate, and cuts against this
effort's own standing preferences (single operator, incremental/low-regret). The failure mode this
would guard against (an _extended_, not brief, Omni outage) is handled more proportionately by
mitigations this repo already uses elsewhere: VM snapshots/backups (mirroring Sidero's own
recommendation), disciplined upgrade timing (nothing on this platform has an SLA forcing a mid-day
upgrade), and Omni's own documented "break glass" mechanism as the sanctioned emergency lever for
workload-cluster access if it's needed mid-outage.

## Considered Options

- **Single VM, embedded etcd** (chosen) — matches Sidero's own default recommendation for
  self-hosted deployments at this scale; ~99.9% achievable uptime via ordinary VM practices; the
  accepted risk (paused GitOps reconciliation and external access during an extended outage) doesn't
  extend to already-running workloads.
- **Single Omni, external etcd** — rejected for now: improves durability of Omni's own state (data
  survives a local-disk failure) but doesn't add process redundancy — a VM-level outage or upgrade
  still takes the single Omni instance offline either way. ADR 0004 already solved the identical
  durability problem for OpenBao cheaply (NAS-backed single-node storage); the same pattern applies
  here without standing up a dedicated etcd cluster just for this.
- **Kubernetes-hosted Omni (non-Omni-managed cluster)** — rejected: Omni must never run on a cluster
  it manages itself (circular dependency), so this would require a _third_, purpose-built Kubernetes
  cluster this repo doesn't otherwise need, just to host Omni. Sidero's own docs note this "typically
  does not provide significantly higher availability than a single-VM deployment" anyway — faster
  crash recovery, not redundancy.
- **Full Omni HA** (multi-replica, external HA etcd, HA registry/Image-Factory/auth/secrets) —
  rejected: ~12-server minimum, "very high complexity," explicitly positioned by Sidero for
  ≈99.99%-uptime requirements with mature ops teams — disproportionate to the actual risk (paused
  GitOps sync, not workload downtime) for a single-operator homelab.

## Consequences

- `CONTEXT.md`'s **Management host** entry gains an explicit note on the accepted availability
  tradeoff, cross-referencing ADR 0011's Omni-proxy-dependency finding.
- Operational practice, not new infrastructure: schedule Omni upgrades deliberately, keep VM
  snapshots current, and know that break-glass access is the documented lever if workload-cluster
  access is needed during an extended outage.
- If this repo's scale or uptime requirements change materially (e.g., genuinely production-grade
  SLAs, many more clusters/nodes), the external-etcd tier is the first proportionate escalation step
  — not a redesign, since Omni's own deployment model already documents it as a supported upgrade
  path from single-VM.
- **Addendum (from [#52](https://github.com/aaronkyriesenbach/catalyst/issues/52)), re-confirming rather
  than revising this ADR's reasoning**: break-glass access requires a live `omnictl talosconfig
--cluster <name> --break-glass` call against a _running_ Omni instance — it mints an escape-hatch
  credential, it cannot be minted after Omni is gone. It therefore only helps the "Omni reachable but
  something in the managed path is degraded" case, not total Management-host loss; recovery from the
  latter is, and remains, VM-snapshot restore (above), after which normal Omni-proxied access resumes
  and break-glass is never needed. Pre-generating and stashing a break-glass credential ahead of time
  as insurance against the snapshot-restore gap was considered and rejected: it trades a bounded,
  already-accepted restore delay for a standing, dormant `os:operator`-role credential living outside
  Omni's own revocation/audit story, undetectable until a CA rotation that nothing prompts you to run
  proactively — a worse tradeoff for a single-operator homelab with no uptime SLA.
