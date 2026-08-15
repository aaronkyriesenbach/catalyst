# Research: ReadWriteMany storage backend options

Issue: [#22](https://github.com/aaronkyriesenbach/catalyst/issues/22), part of the
"Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

## Question

Survey RWX (`ReadWriteMany`)-capable storage backends for the cluster, given that
storage today is `local-path` (node-local, RWO-only) plus TrueNAS iSCSI (RWO-only,
via `csi.truenas.io`). Cover TrueNAS-backed NFS, Rook-Ceph, and any other viable
options for a small (2 nodes today, growing), single-operator homelab.

## Current state (from repo)

- `apps/truenas-csi.ts` deploys the **TrueNAS CSI driver** (`csi.truenas.io`) and
  defines one `StorageClass` named `truenas-iscsi` with
  `parameters.protocol: "iscsi"`, `reclaimPolicy: Delete`,
  `volumeBindingMode: Immediate`, `allowVolumeExpansion: true`. This is the only
  dynamically-provisioned StorageClass in the repo today, and it is **RWO-only**
  in practice — `modifiers.ts`'s `withIscsiVolumes` forces the workload's deploy
  strategy to `Recreate` because "iSCSI volumes can only be mounted by one pod at
  a time" (`.agents/skills/create-catalyst-app/references/modifiers.md`).
- `storage.ts` and `modifiers.ts`'s `withNasMounts` already give apps
  **ReadWriteMany** access today, but via a static, hand-wired NFS export, not a
  StorageClass:
  - `modifiers.ts` hardcodes `NAS_SERVER = "192.168.53.120"` and
    `NAS_PATH = "/mnt/tank/data"` and injects an in-tree Kubernetes `nfs:` volume
    (not a PVC) directly into the pod spec via `nasVolume()`/`nasVolumeMounts()`.
  - `storage.ts`'s `buildNasPersistentVolumePair` builds a manually-defined
    `PersistentVolume` (with an inline `nfs: { server, path }` block) paired with
    a `PersistentVolumeClaim` bound to it by name, defaulting
    `accessModes: ["ReadWriteMany"]` and `reclaimPolicy: "Retain"`.
  - Neither path is dynamically provisioned: there's no `StorageClass` with an
    NFS provisioner, no per-PVC subdirectory creation, and no lifecycle
    management (deleting the PVC doesn't reclaim NAS space).
- `local-path` (k3s's bundled `local-path-provisioner`) is node-local and RWO-only
  by design — it binds a PV to whichever node's local disk it provisioned on.
- Cluster topology: 2 Proxmox/k3s nodes today, more planned, eventual hardware
  replacement (per ticket context).

## Option 1: TrueNAS CSI — NFS protocol (reuse existing NAS, existing driver)

**Source:** [truenas/truenas-csi README](https://github.com/truenas/truenas-csi) (fetched 2024, `master` branch).

The CSI driver **already deployed** in this cluster (`csi.truenas.io`, defined in
`apps/truenas-csi.ts`) is not iSCSI-only. Its own feature list states:

> - **NFS volumes** - ReadWriteMany (RWX) access mode for shared storage
> - **iSCSI volumes** - Block storage with ReadWriteOnce (RWO) and ReadWriteMany (RWX) access modes (RWX requires cluster filesystem like GFS2/OCFS2)

And under Node Requirements: "**NFS volumes**: No additional requirements" (vs.
iSCSI, which needs `open-iscsi` on every node — already handled per
`docs/postgres-migration.md`).

The driver ships a ready-made example StorageClass
(`examples/storageclass-nfs.yaml` in the same repo) that is a near-drop-in for
this codebase:

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: truenas-nfs
provisioner: csi.truenas.io
parameters:
  protocol: "nfs"
  datasetPath: "k8s/nfs"      # keeps CSI-managed datasets grouped under the pool
  compression: "LZ4"
  # nfs.rootSquash: "true"    # default; set "false" if a pod's fsGroup needs
                               # to own the volume root
reclaimPolicy: Delete
volumeBindingMode: Immediate
allowVolumeExpansion: true
```

Requirements: TrueNAS SCALE 25.10.0+ with API access enabled, at least one ZFS
pool, Kubernetes 1.26+ (README, "Requirements" section). It also supports online
volume expansion, ZFS compression/encryption per StorageClass, and scheduled
snapshots (same README, "Features").

**Why this is the strongest option for this cluster:**

- Zero new infrastructure — reuses the trusted NAS (`192.168.53.120`) and the
  CSI driver already running in the cluster (`apps/truenas-csi.ts`).
- Adds real **dynamic provisioning** (a second StorageClass, e.g. `truenas-nfs`)
  where today's RWX story (`withNasMounts`) is a hand-wired static export with no
  per-PVC isolation or lifecycle management.
- No dependency on node count — the NAS is external to the k3s nodes, so this
  scales cleanly from 2 nodes to N nodes with no rebalancing/quorum concerns.
- Directly closes the gap the ticket names: "no RWX today" via dynamic PVCs.

**Caveats:**

- Still a single point of failure at the NAS (true of the existing iSCSI setup
  too, so this doesn't change the blast-radius model).
- NFS is explicitly **not** viable for Postgres per this repo's own migration
  doc (`docs/postgres-migration.md`: "NFS is not a supported storage backend for
  Postgres and causes WAL corruption") — this option is for shared-filesystem
  workloads (media libraries, shared config/state), not databases. Postgres
  correctly stays on `truenas-iscsi` RWO.
- Root-squash is on by default (`nfs.rootSquash: "true"`), which maps root to
  nobody; the driver's own example
  (`storageclass-nfs-fsgroup.yaml`, referenced in the README/example StorageClass
  comments) documents flipping `nfs.rootSquash: "false"` when a pod's `fsGroup`
  needs to own the volume root — same class of tuning already needed for
  non-root workloads on iSCSI.

## Option 2: Rook-Ceph (CephFS, node-local disks)

**Sources:** [Rook Prerequisites](https://github.com/rook/rook/blob/master/Documentation/Getting-Started/Prerequisites/prerequisites.md), [Rook Quickstart](https://github.com/rook/rook/blob/master/Documentation/Getting-Started/quickstart.md), [Rook Ceph Cluster CRD](https://github.com/rook/rook/blob/master/Documentation/CRDs/Cluster/ceph-cluster-crd.md), [Rook Shared Filesystem (CephFS) guide](https://github.com/rook/rook/blob/master/Documentation/Storage-Configuration/Shared-Filesystem-CephFS/filesystem-storage.md) (all `master` branch).

Rook's CephFS (`CephFilesystem` CRD) is the RWX primitive: "A filesystem storage
(also named shared filesystem) can be mounted with read/write permission from
multiple pods" (Shared-Filesystem-CephFS doc). It's backed by an MDS (metadata
server) plus replicated data/metadata pools on OSDs made from raw local disks.

**Node/hardware requirements, from Rook's own docs:**

- Rook's production example manifest explicitly "Requires at least three worker
  nodes" (`quickstart.md`, describing `cluster.yaml`). The quickstart's healthy
  cluster example shows 3 mon pods and OSD-prepare jobs on 3 distinct nodes.
- Ceph OSDs need dedicated **raw** block devices/partitions/LVM volumes with no
  existing filesystem (Prerequisites doc: "at least one of these local storage
  types is required: Raw devices... Raw partitions... LVM Logical Volumes...").
  `lsblk -f` must show an empty `FSTYPE` column for a disk to be eligible.
- Mon count (`mon.count` in the `CephCluster` CRD) "must be between 1 and 9. The
  recommended value is most commonly 3" (Cluster CRD doc) — quorum-based, so an
  even number doesn't buy extra safety and 1 mon has no HA.
- LVM (`lvm2`) must be installed on every node that will run OSDs if encryption,
  a metadata device, or `osdsPerDevice > 1` is used (Prerequisites doc).
- Rook explicitly recommends OSD anti-affinity spread across nodes ("at a
  minimum, anti-affinity should be added so at least one OSD will be placed on
  each available node" — Cluster CRD doc), which only pays off once there are
  several nodes.

**Assessment for this cluster:** Ceph's whole value proposition (data
replication + MDS/mon quorum) assumes ≥3 nodes with dedicated raw disks per
node. At today's 2 nodes, Rook-Ceph would either run a single-replica,
no-quorum "cluster" (against the project's own guidance) or need
`allowMultiplePerNode: true` for mons — which Rook's docs flag as a
test-environment-only setting ("Should only be set to `true` in test
environments" — Cluster CRD doc). It's also a heavier operational surface for a
single operator: MDS/mon/OSD lifecycle, its own upgrade cadence, and raw-disk
management on Proxmox VMs (passing through raw block devices to k3s VMs adds
Proxmox-side complexity not needed by NFS).

**Verdict:** Rook-Ceph is the right long-term answer *if and when* the node
count reaches 3+ with dedicated local disks (e.g. after the planned hardware
replacement) and workloads need storage failure-domain independent of the NAS.
Revisit post-expansion; premature today given the 2-node reality and the
"cheap is fine, but justify it" bar — Ceph's justification (node-local
redundancy, no NAS SPOF) doesn't hold until there are enough nodes/disks to
replicate across.

## Option 3: Community NFS provisioners on top of the existing NAS export

**Source:** [kubernetes-sigs/nfs-subdir-external-provisioner README](https://github.com/kubernetes-sigs/nfs-subdir-external-provisioner) (`master` branch).

This is a lighter-weight alternative to Option 1 for dynamic RWX provisioning:
"an automatic provisioner that uses your *existing and already configured* NFS
server to support dynamic provisioning of Kubernetes Persistent Volumes... via a
single NFS export, using per-PVC subdirectories" (`${namespace}-${pvcName}-${pvName}`
per the README). No TrueNAS API integration needed — it only needs the NFS
export the TrueNAS box already serves.

**Assessment:** Functionally this fills the same gap as Option 1's `truenas-nfs`
StorageClass, but with strictly less capability: no per-volume ZFS dataset
isolation/quota, no snapshot integration, no encryption, no volume expansion
guarantees tied to ZFS — everything lives as subdirectories under one export.
Since the TrueNAS CSI driver's native NFS protocol is already deployed and gets
all of that natively with less code, this option is only worth it if the
TrueNAS CSI driver ever becomes unavailable/unsupported. Not recommended while
Option 1 is on the table.

## Option 4: democratic-csi (legacy/alternative TrueNAS driver)

**Source:** [democratic-csi/democratic-csi README](https://github.com/democratic-csi/democratic-csi) (`master` branch).

`democratic-csi` predates `truenas-csi` and supports NFS/iSCSI/SMB/NVMe-oF
against FreeNAS/TrueNAS and generic ZFS-on-Linux hosts, including a
`freenas-api-nfs` driver "experimental use with SCALE only." It's a mature,
broadly-used project across the homelab community, but it's not first-party
(`truenas-csi` is the official iXsystems/TrueNAS-maintained driver, and this
repo has already standardized on it — see `apps/truenas-csi.ts`).

**Assessment:** No reason to introduce a second CSI driver, a second codebase to
trust, and a second set of StorageClass parameters when the already-deployed,
vendor-maintained driver (`csi.truenas.io`) supports NFS/RWX natively (Option
1). Not recommended.

## Option 5: Longhorn (node-local disks, RWX via internal NFS gateway)

**Source:** [longhorn/longhorn README](https://github.com/longhorn/longhorn) (`master` branch).

Longhorn is a distributed block-storage system that "creates a dedicated storage
controller for each block device volume and synchronously replicates the volume
across multiple replicas stored on multiple nodes" (README, "What is Longhorn").
RWX support is implemented via a dedicated component: "**Longhorn Share
Manager** — NFS provisioner that exposes Longhorn volumes as ReadWriteMany
volumes" (README component table) — i.e. Longhorn attaches its replicated block
volume to an internal per-volume NFS server pod, then serves that out as RWX.

**Assessment:** Like Rook-Ceph, Longhorn's replication model wants multiple
nodes with local disks to spread replicas across (fewer nodes means replicas
degrade to non-redundant or can't be placed at all), and its RWX path adds an
extra NFS-gateway hop *in front of* a replicated block device — more moving
parts than just using the NAS's NFS directly. It's a reasonable alternative to
Rook-Ceph if block-level replica-per-node granularity or a lighter operational
footprint than Ceph is wanted later, but it doesn't beat Option 1 today, and it
shares Option 2's "needs more nodes with local disks to be worth it" limitation.
Worth a second look in the same "3+ nodes, node-local disks" future scenario as
Rook-Ceph, not now.

## Recommendation

1. **Now:** Add a second TrueNAS CSI StorageClass, `truenas-nfs`
   (`provisioner: csi.truenas.io`, `parameters.protocol: "nfs"`), using the
   driver's own example
   (`examples/storageclass-nfs.yaml` in `truenas/truenas-csi`) as the template.
   This is the lowest-effort, lowest-risk way to get real dynamically-provisioned
   RWX volumes: no new infrastructure, reuses the already-deployed driver and
   already-trusted NAS, and it's a strict upgrade over today's hand-wired
   `withNasMounts`/`buildNasPersistentVolumePair` static NFS mounts (adds
   per-PVC isolation, quotas, and lifecycle management that the static path
   lacks). Keep Postgres and other WAL-sensitive workloads on `truenas-iscsi`
   RWO per the existing `docs/postgres-migration.md` guidance — NFS is not
   revisiting that decision.
2. **Migration path:** New apps needing shared/multi-writer storage should move
   to PVCs on `truenas-nfs` instead of new `withNasMounts` call sites; existing
   `withNasMounts` usage can be migrated opportunistically since it's already
   functionally RWX today.
3. **Later (post node-count growth / hardware refresh):** Revisit Rook-Ceph
   (CephFS) once there are 3+ nodes with dedicated local disks to spread
   OSDs/mons across, per Rook's own "at least three worker nodes" production
   guidance. That buys storage-failure-domain independence from the NAS.
   Longhorn is a lighter-weight alternative to evaluate in that same future
   scenario if Ceph's operational overhead proves too heavy for a single
   operator.
4. **Not recommended:** `nfs-subdir-external-provisioner` and `democratic-csi`
   — both are strictly dominated by the already-deployed `truenas-csi` driver's
   native NFS protocol support for this cluster's use case.
