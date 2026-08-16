# Storage backend: NAS-centralized, split by workload shape

Status: accepted

Two separate storage decisions, both keeping storage centralized on the existing TrueNAS NAS
(`192.168.53.120`) rather than adopting node-local storage (Rook-Ceph, Longhorn) at any node count —
a deliberate, standing preference driven by the multi-cluster/multi-experimental-cluster goal: storage
should never be tied to which node(s) happen to exist in a given cluster. This rules out Rook-Ceph and
Longhorn permanently, not just until node count grows, superseding the "revisit at 3+ nodes" framing in
[research #22](https://github.com/aaronkyriesenbach/catalyst/issues/22).

## Shared/bulk file storage

Add a `truenas-nfs` `StorageClass` on the already-deployed TrueNAS CSI driver (`csi.truenas.io`,
`protocol: nfs`) for shared/bulk file storage (media libraries, shared config/state) — a dynamically-
provisioned, per-PVC-isolated strict upgrade over today's hand-wired static NFS PVs
(`buildNasPersistentVolumePair`/`withNasMounts`). `reclaimPolicy: Retain` (unlike `truenas-iscsi`'s
`Delete`), matching today's safety posture for irreplaceable NAS-backed data (e.g. Immich's photo
library) in a single-operator homelab with no one else to catch an accidental PVC delete. Migration of
the 13 existing `withNasMounts`/`buildNasPersistentVolumePair` call sites onto `truenas-nfs` PVCs is
opportunistic, consistent with the app-by-app migration strategy
([#31](https://github.com/aaronkyriesenbach/catalyst/issues/31)) — not a mandated cutover.

## Runtime/stateful-workload storage

The real gap wasn't shared storage — it's the ~12 apps (`withIscsiVolumes`/`withPostgres`, mostly
embedded SQLite-style databases) stuck on `truenas-iscsi` (RWO), which forces Deployment
`strategy: Recreate` (full downtime on every restart) and rules out horizontal scaling. Plain NFS isn't
a safe substitute: SQLite's own docs state WAL mode architecturally cannot work over a network
filesystem (a shared-memory requirement, not a locking-quality problem), the same class of restriction
already documented for Postgres WAL in `docs/postgres-migration.md`.

[Research #39](https://github.com/aaronkyriesenbach/catalyst/issues/39) (`docs/research/runtime-storage-research.md`)
found no centralized-storage fix for the downtime problem:

- **iSCSI RWX via a clustered filesystem (GFS2/OCFS2) is not viable** — ruled out three independent
  ways: SQLite's WAL-mode shared-memory requirement makes it architecturally incompatible with any
  multi-host filesystem regardless of lock correctness; the DLM/Corosync/STONITH stack both filesystems
  require is disproportionate operational surface for a single operator; and, decisively, Talos (this
  repo's target cluster OS, ADR 0002) compiles `GFS2_FS`/`OCFS2_FS`/`DLM` out of its kernel entirely,
  with no system extension to add them back.
- **NVMe-oF is adopted, but only as a performance upgrade** — a `truenas-nvmeof` `StorageClass`, using
  the driver's native NVMe-oF/TCP support. It needs zero new Talos system extensions (`NVME_FABRICS`/
  `NVME_TCP` are already compiled into Talos's stock kernel, unlike iSCSI's `iscsi-tools` extension
  requirement) and is a real latency/IOPS win, but it carries the exact same RWO/`Recreate` semantics as
  iSCSI — it does not touch the downtime problem. It's additive, not a replacement: new runtime-storage
  workloads default to `truenas-nvmeof`; existing `truenas-iscsi` apps migrate opportunistically;
  `truenas-iscsi` can be deprecated once nothing references it.
- **ALUA/ TrueNAS-native fast failover is not applicable** — a TrueNAS Enterprise dual-controller
  hardware feature this NAS doesn't have, and it solves NAS-controller redundancy, not Kubernetes
  pod-reschedule latency, even where available.
- **`PodDisruptionBudget` is a dead end** — explicitly documented as not governing Deployment/StatefulSet
  rollout replacement, only voluntary evictions/drains.

**Decision: accept `Recreate`-strategy downtime for single-writer embedded-SQLite/DB apps.** No
centralized-storage option removes it without an unacceptable trade-off. The research surfaced one
technically-plausible mitigation — pinning a workload to one node (RWO restricts to a node, not a pod,
so same-node pod reuse is theoretically possible) and switching to `RollingUpdate` — but it was
deliberately **not adopted**: it trades away cross-node scheduling flexibility for every pinned app, and
the operator does not want any node-pinning in this fleet.

**Horizontal scale-out is confirmed out of scope for this decision entirely.** Per Postgres's and
Redis's own documentation, both scale by running independent replicas with their own separate storage,
coordinated over an application-level replication protocol — never through a shared multi-attach
volume. Storage access mode (RWO vs RWX) is orthogonal to scale-out and already no obstacle to it today.
This is fully owned by [#25](https://github.com/aaronkyriesenbach/catalyst/issues/25) (database-as-a-
service); embedded-SQLite apps have no scale-out story on any storage backend, full stop.

## Considered Options

- **Rook-Ceph / Longhorn (node-local storage)** — rejected outright, permanently: conflicts with the
  standing centralized-storage-over-node-local preference (multi-cluster goal), independent of node
  count. Previously also ruled out for needing 3+ nodes with dedicated local disks
  ([research #22](https://github.com/aaronkyriesenbach/catalyst/issues/22)).
- **Community NFS provisioners / `democratic-csi`** — rejected: strictly dominated by the already-
  deployed, vendor-first-party `truenas-csi` driver's native NFS support.
- **iSCSI RWX via GFS2/OCFS2** — rejected; see above.
- **Node-pinning + `RollingUpdate`** — rejected by explicit operator preference, despite being
  technically the only path found to a near-zero-downtime restart on today's infrastructure.

## Consequences

- Two new `StorageClass`es to add: `truenas-nfs` (`reclaimPolicy: Retain`) and `truenas-nvmeof`
  (`reclaimPolicy: Delete`, matching `truenas-iscsi`'s convention for ephemeral runtime data).
- `truenas-iscsi` stays in place indefinitely as a legacy path; no forced migration timeline.
- Whoever implements `truenas-nvmeof` should first confirm the TrueNAS box runs SCALE 25.10+ (the
  driver's NVMe-oF version floor) — an implementation-time check, not a re-open of this decision.
- [#25](https://github.com/aaronkyriesenbach/catalyst/issues/25) (database-as-a-service) should design
  its per-replica storage against `truenas-nvmeof`/`truenas-iscsi` as appropriate, and owns the entire
  scale-out question independent of this ADR.
- `docs/postgres-migration.md`'s NFS-unsafe-for-Postgres rationale is now joined by the same
  architectural argument for SQLite — worth a cross-reference if that doc is revisited.
