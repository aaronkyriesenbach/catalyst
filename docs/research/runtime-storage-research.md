# Research: NAS-centralized runtime/stateful-workload storage options beyond iSCSI RWO

Issue: [#39](https://github.com/aaronkyriesenbach/catalyst/issues/39), part of the
"Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

## Question

> ## Question
>
> Survey storage protocols/technologies, hosted centrally on the existing TrueNAS NAS (`192.168.53.120`) — not node-local disks — for **runtime/stateful application storage**: today's ~12 apps on `withIscsiVolumes`/`withPostgres` (mostly embedded SQLite-style databases: `home-assistant`, `trilium`, `poznote`, `navidrome`, `jellyfin`, `filebrowser-quantum`, `qbittorrent`, `reader`, `sublime`; plus Postgres via `miniflux`/`shakedown`).
>
> Current pain, per `modifiers.ts`/`docs/postgres-migration.md`: iSCSI (`csi.truenas.io`, RWO) forces Deployment `strategy: Recreate` (real downtime on every restart/upgrade) and rules out horizontal scaling for apps that support it. Plain NFS isn't a safe substitute — SQLite (like Postgres WAL) is documented as unsafe over network-filesystem POSIX locking, causing corruption risk, not just a performance concern.
>
> Explicit standing preference (from ticket #23's grilling session): centralized NAS-hosted storage is preferred over node-local storage (Rook-Ceph/Longhorn) even as node count grows, because of a stated multi-cluster/multi-experimental-cluster goal — storage should not be tied to which node(s) happen to exist in a given experimental cluster.
>
> Cover at least:
>
> 1. **TrueNAS CSI iSCSI RWX via clustered filesystem** — the driver's own docs (surfaced in #22's research) note iSCSI supports RWX access mode when paired with a cluster filesystem (GFS2/OCFS2). Does this genuinely enable safe zero-downtime rolling restarts for the embedded-SQLite apps listed above, or does the app-level single-writer assumption make concurrent-mount RWX unsafe/pointless regardless of the filesystem's cluster-awareness? What operational surface does running GFS2/OCFS2 (DLM, fencing) add for a single operator?
> 2. **NVMe-oF** — does TrueNAS SCALE / the `truenas-csi` driver support NVMe-oF as a lower-latency alternative to iSCSI? Does it change the RWO/Recreate story at all, or is it purely a latency/throughput improvement over the same RWO semantics?
> 3. **TrueNAS-native fast-failover features** — ALUA/multipathing or similar that could shorten today's detach/reattach gap on pod reschedule without requiring RWX at all.
> 4. **Whether real horizontal scale-out is possible for apps that support it** (e.g. Postgres/Redis) against centralized storage — or whether scaling is inherently an app-level (replication/clustering) concern independent of the storage backend's access mode, meaning the storage decision here can only ever fix the _restart-downtime_ half of the ask, never the _scale-out_ half.
>
> Cite all claims to primary sources (vendor docs/driver READMEs), consistent with #22's research.

The task brief for this write-up expands the fourth bullet above into two explicit
sub-questions (Kubernetes-level mitigations, and a sharper framing of the scale-out
question); both are covered below as items 4 and 5.

## Current state (from repo)

- `modifiers.ts`'s `withIscsiVolumes` provisions one `truenas-iscsi` PVC per configured
  mount and **hardcodes `strategy: { type: "Recreate" }`** on the returned `WorkloadApp` —
  every app using it (`home-assistant`, `trilium`, `poznote`, `navidrome`, `jellyfin`,
  `filebrowser-quantum`, `qbittorrent`, `reader`, `sublime`, and also `open-webui`) takes a
  full down-then-up restart on every rollout, with no override.
- `withPostgres(version)` (no `legacy` flag) generates a separate single-replica
  `StatefulSet` with a `truenas-iscsi`-backed `volumeClaimTemplate`
  (`buildIscsiPvcTemplate` in `utils.ts`) for `miniflux` and `shakedown`. StatefulSets don't
  use `strategy: Recreate` (that's a Deployment-only field), but a single-replica
  StatefulSet restart hits the same underlying gate: the old pod's PVC must fully detach
  before the replacement pod (same ordinal, same PVC) can attach it, for the same RWO
  reason as the Deployments above.
- `apps/truenas-csi.ts` deploys the TrueNAS CSI driver (`csi.truenas.io`) from the vendored
  `apps/truenas-csi/deploy.yaml`, using image `ghcr.io/truenas/truenas-csi:latest` (a
  floating tag) with `defaultPool: "tank"`. It defines exactly one `StorageClass`,
  `truenas-iscsi` (`parameters.protocol: "iscsi"`), no NFS or NVMe-oF `StorageClass` exists
  in the repo today, and the driver's ConfigMap doesn't set `nvmeofPortal`.
- `storage.ts`'s `buildNasPersistentVolumePair` and `modifiers.ts`'s `withNasMounts` give
  apps a separate, static, hand-wired NFS mount (`192.168.53.120:/mnt/tank/data`) — this is
  a different, already-RWX code path used for shared/bulk file storage, not for the
  embedded-database files this ticket is about.
- `docs/postgres-migration.md` documents _why_ Postgres moved off NFS entirely: "NFS is not
  a supported storage backend for Postgres and causes WAL corruption." Prior research
  (issue #22, branch `research/storage-research`) already surveyed centralized-vs-node-local
  RWX options in general and ruled out Rook-Ceph and Longhorn for this cluster specifically
  because both need 3+ nodes with dedicated local disks to be worth their operational cost,
  and because the operator has an explicit, already-decided standing preference for
  centralized NAS-hosted storage over node-local storage as the cluster grows (multi-cluster
  homelab goal, storage independent of which nodes exist in a given experimental cluster).
  That decision is treated as settled context here, not re-litigated.
- Per `CONTEXT.md` / ADR 0002, the target architecture is **Talos + Omni**-managed clusters
  (`Cluster layer`: "creating, joining, and upgrading Talos node VMs"), even though today's
  live cluster is k3s. Kernel-module and userspace-tooling availability on Talos is treated
  as first-class context below, alongside today's k3s reality, because any storage decision
  here needs to survive the migration.

## 1. iSCSI RWX via a clustered filesystem (GFS2/OCFS2)

**Source:** [truenas/truenas-csi](https://github.com/truenas/truenas-csi), commit
`d5fddc0` (2026-07-17, `master` branch).

The driver's README does say this, in its top-level feature list:

> - **iSCSI volumes** - Block storage with ReadWriteOnce (RWO) and ReadWriteMany (RWX) access
>   modes (RWX requires cluster filesystem like GFS2/OCFS2)

But reading the driver's own source and its official first-party documentation tells a much
more qualified story than that one line suggests.

### The driver doesn't implement or assist RWX for iSCSI — it just doesn't block it

`pkg/driver/driver.go` sets the CSI plugin's advertised access-mode list once, for the whole
driver (not per-protocol), with this comment directly above it:

```go
// Volume access modes - only advertise modes we actually support
// SINGLE_NODE_MULTI_WRITER requires cluster-aware filesystem which we don't provide
d.volumeCaps = []*csi.VolumeCapability_AccessMode{
    ...
    {Mode: csi.VolumeCapability_AccessMode_MULTI_NODE_SINGLE_WRITER},
    {Mode: csi.VolumeCapability_AccessMode_MULTI_NODE_MULTI_WRITER},
}
```

The driver's own OpenShift CSI-certification test manifests (`docs/openshift/certification.md`)
make the practical position explicit — the driver declares different capabilities per
protocol for the standard `ose-tests`/e2e CSI conformance suite:

> - NFS: `RWX: true`, `block: false`, `nodeExpansion: false` (server-side only)
> - iSCSI: `RWX: false`, `block: true`, `nodeExpansion: true`, `singleNodeVolume: true`

`ControllerPublishVolume` in `pkg/driver/controller.go` — the RPC that would be the natural
place for the driver to reject or coordinate a second node attaching the same LUN — does no
such check for iSCSI. It only looks up TrueNAS connection details (portal, IQN, LUN) and
returns them; `ControllerUnpublishVolume` is a documented no-op ("cleanup happens at node
level"). There is no dataset-level lock, no reservation, nothing TrueNAS-side that would
prevent two Kubernetes nodes from both logging into the same iSCSI target concurrently if a
PVC requesting `ReadWriteMany` against `truenas-iscsi` were created. `NodeStageVolume`
(`pkg/driver/node.go`, `pkg/driver/iscsi.go`) mounts the LUN with plain
`k8s.io/mount-utils` `SafeFormatAndMount` using whatever `fsType` the `StorageClass`/PVC
specifies — there is no GFS2/OCFS2-aware code path anywhere in the driver (no `mkfs.gfs2`/
`mkfs.ocfs2` invocation, no DLM/corosync integration, no fencing logic). `rg`-ing the whole
source tree for `gfs2`/`ocfs2` (case-insensitive) returns nothing outside the README line
quoted above.

In other words: the README's parenthetical is accurate but easy to over-read. It means "the
driver will not stop you from mounting the same iSCSI LUN RWX," not "the driver provides,
tests, or supports a working GFS2/OCFS2 setup." TrueNAS's own first-party documentation site
(`www.truenas.com/docs`, not just the GitHub README) reinforces this: its
[CSI Driver Reference](https://www.truenas.com/docs/solutions/integrations/csidriver/csidriverreference/)
page's own protocol-comparison table lists `ReadWriteMany ✓ (NFS)` and every `ReadWriteMany`
example PVC in that guide uses `storageClassName: truenas-nfs` — the vendor's own docs never
show or recommend an RWX iSCSI example anywhere.

### Even with a correctly-working cluster filesystem, SQLite's WAL mode cannot use it — this is not a locking-quality problem

This is the crux of the sub-question, and it has a direct primary-source answer that doesn't
require guessing by analogy to Postgres. SQLite's own [Write-Ahead Logging
documentation](https://www.sqlite.org/wal.html) states, as an unconditional requirement, not
a caveat about locking reliability:

> 1. All processes using a database must be on the same host computer; WAL does not work over
>    a network filesystem. This is because WAL requires all processes to share a small amount
>    of memory and processes on separate host machines obviously cannot share memory with each
>    other.

And, later on the same page, explaining _why_ in more detail:

> The wal-index greatly improves the performance of readers, but the use of shared memory
> means that all readers must exist on the same machine. This is why the write-ahead log
> implementation will not work on a network filesystem.

A GFS2/OCFS2-backed iSCSI volume mounted by two different Kubernetes worker nodes is, by this
definition, exactly the disqualifying case: two separate host machines (VMs) accessing the
same database file. It doesn't matter how correctly GFS2/OCFS2 implement POSIX byte-range
locking across nodes — WAL mode's coordination between reader and writer connections depends
on an `mmap`'d shared-memory segment (the `-shm` file / wal-index) that is only ever coherent
within a single host's page cache. There is no "SQLite is fine with this on a real cluster
filesystem" carve-out anywhere in SQLite's documentation; the restriction is architectural,
not a quality-of-implementation problem the way NFS's broken locking is. (SQLite does have an
exclusive-locking-mode escape hatch that removes the shared-memory requirement — see
[wal.html](https://www.sqlite.org/wal.html), "Read-only databases and WAL databases without
shared memory" — but that mode requires `PRAGMA locking_mode=EXCLUSIVE` set _before_ the first
access and only ever lets one connection touch the database at all, which is a stronger
restriction than what any of these apps' current single-pod-at-a-time deployment already
gives them for free; it buys nothing for a rolling restart.)

If any of the ~9 embedded-SQLite apps run in the SQLite default rollback-journal mode instead
of WAL (this hasn't been verified per-app here and would need checking per application), the
constraint shifts but doesn't improve: rollback-journal mode's cross-process coordination is
"SQLite uses file locks on the database file... to coordinate access between concurrent
processes" via POSIX advisory `fcntl()` locks
([howtocorrupt.html](https://www.sqlite.org/howtocorrupt.html), "2. File locking problems").
SQLite's own locking documentation is explicit that this depends on the underlying filesystem
implementing those locks correctly, and singles out network filesystems as the class of
concern:

> SQLite depends on the underlying filesystem to do locking as the documentation says it will.
> But some filesystems contain bugs in their locking logic such that the locks do not always
> behave as advertised. **This is especially true of network filesystems and NFS in
> particular.**

and, from [lockingv3.html](https://www.sqlite.org/lockingv3.html):

> SQLite uses POSIX advisory locks to implement locking on Unix... One should note that POSIX
> advisory locking is known to be buggy or even unimplemented on many NFS implementations
> (including recent versions of Mac OS X)... Your best defense is to not use SQLite for files
> on a network filesystem.

GFS2 and OCFS2 are a materially different case from plain NFS here — both implement real
cluster-coordinated POSIX byte-range locking via a Distributed Lock Manager rather than an
unreliable NFS lock daemon, so the specific "locks are buggy/unimplemented" failure mode
SQLite calls out for NFS does not obviously apply to them the same way. But this repo has no
SQLite-on-GFS2/OCFS2 track record, no vendor states it's supported, and — decisively for the
apps that use WAL mode — the shared-memory requirement above makes it a non-starter
regardless of lock correctness. This is not a case where "SQLite's docs are cautious about
NFS specifically, so a real cluster filesystem is fine" is a safe inference for this fleet.

### Operational surface: DLM, fencing, and — decisively — no path on Talos

Independent of the SQLite-safety question, actually standing up GFS2 or OCFS2 is a
significant addition to a single-operator homelab's operational surface. From SUSE's official
HA documentation (chosen because Red Hat's equivalent docs return HTTP 403 to automated
fetches; SUSE's guide covers the same DLM/fencing architecture both cluster filesystems
share):

**GFS2** ([SUSE Linux Enterprise High Availability 15 SP5 — GFS2](https://documentation.suse.com/sle-ha/15-SP5/html/SLE-HA-all/cha-ha-gfs2.html)):

> Using GFS2 in a cluster requires hardware to allow access to the shared storage, and a lock
> manager to control access to the storage... Before you can create GFS2 volumes, you must
> configure DLM and a STONITH resource... You need to configure a fencing device. Without a
> STONITH mechanism (like `external/sbd`) in place the configuration will fail... Number of
> Journals (`-j`): The number of journals for gfs2_mkfs to create. You need at least one
> journal per machine that will mount the file system.

and, notably:

> **Important: GFS2 support** — SUSE only supports GFS2 in read-only mode. Write operations
> are not supported.

(That's SUSE's own commercial-support scoping for their HA product, not a claim that GFS2 the
filesystem is read-only everywhere — other distributions support read-write GFS2 clusters —
but it's a real, citable signal that even a major enterprise Linux vendor treats write-mode
GFS2 as something they won't stand behind for a customer, which matters for a
single-operator homelab with no vendor support contract of any kind to fall back on.)

**OCFS2** ([SUSE Linux Enterprise High Availability 15 SP5 — OCFS2](https://documentation.suse.com/sle-ha/15-SP5/html/SLE-HA-all/cha-ha-ocfs2.html)):

> A user space control daemon, managed via a clone resource, provides the integration with the
> HA stack, in particular with Corosync and the Distributed Lock Manager (DLM)... Before you
> can create OCFS2 volumes, you must configure the following resources as services in the
> cluster: DLM and a STONITH resource... Without a STONITH mechanism (like `external/sbd`) in
> place the configuration will fail.

So both filesystems need, at minimum: a Corosync cluster membership layer, a running DLM
resource, a working STONITH/fencing device (SBD, a watchdog/shared-storage-based fencing
mechanism, or an out-of-band power-fencing agent like `fence_pve` for Proxmox), and — for
GFS2 specifically — journal count provisioned per node up front. This is a full HA cluster
stack (Pacemaker + Corosync + DLM + fencing) layered _underneath_ Kubernetes, purely to make
one PVC mountable from two nodes at once — a large, genuinely new category of infrastructure
for a single operator to own, monitor, and safely upgrade, on top of everything Kubernetes
itself already asks of them.

And on this repo's actual target OS, none of it is available at all. Talos's official
system-extensions registry ([siderolabs/extensions](https://github.com/siderolabs/extensions),
`main` branch, `storage/` directory) lists `iscsi-tools`, `trident-iscsi-tools`,
`multipath-tools`, `nfs-utils`, `nfsd`, `nfsrahead`, `zfs`, `btrfs`, `drbd`, and others — no
`gfs2`, `ocfs2`, or `dlm` extension exists. More decisively, Talos's own kernel build
configuration
([siderolabs/pkgs](https://github.com/siderolabs/pkgs/blob/main/kernel/build/config-amd64),
`main` branch, kernel 6.18.44) explicitly disables all three:

```
# CONFIG_GFS2_FS is not set
# CONFIG_OCFS2_FS is not set
...
# CONFIG_DLM is not set
```

Talos doesn't support arbitrary custom kernels the way a general-purpose Linux distribution
does — kernel modules come only from the stock kernel plus the vetted system-extensions
registry via Image Factory. With GFS2/OCFS2/DLM support compiled out and no extension to add
them, there is currently no supported path to run either filesystem on Talos at all — full
stop, independent of every other concern above. Since ADR 0002 and `CONTEXT.md` establish
Talos/Omni as this repo's target cluster-lifecycle direction, this alone is close to
sufficient to rule the option out, even before counting the DLM/fencing overhead or the
SQLite WAL restriction.

**Verdict: not viable.** Killed three independent ways — SQLite's own WAL-mode documentation
makes it an architectural non-starter for any app using WAL (the common case for
performance-conscious embedded-SQLite apps), the DLM/fencing/STONITH stack is a large new
operational surface disproportionate to a single-operator homelab, and the target Talos
kernel doesn't even compile the filesystems in, with no extension available to add them.

## 2. NVMe-oF

**Source:** [truenas/truenas-csi](https://github.com/truenas/truenas-csi), commit `d5fddc0`;
[TrueNAS Documentation Hub — NVMe-oF Subsystems](https://www.truenas.com/docs/scale/shares/nvme-of/).

TrueNAS SCALE has native, first-party NVMe-oF/TCP target support, not just a driver-side
shim. From TrueNAS's own documentation:

> NVMe over TCP is incompatible with VMware ESXi environments. TrueNAS uses the Linux kernel
> NVMe over TCP target driver, which lacks support for "fused commands" required by VMware
> ESXi. This is an upstream kernel limitation that prevents path initialization in ESXi
> environments.

— i.e. it's backed by the mainline Linux kernel's own `nvmet_tcp` target, the same
target the truenas-csi driver's requirements section calls out: "For NVMe-oF volumes:
`nvme_tcp`/`nvme_fabrics` kernel modules available on worker nodes (the node DaemonSet loads
them); requires TrueNAS SCALE 25.10+ with the NVMe-oF target service enabled." The driver's
feature list confirms client-side support: "**NVMe-oF/TCP volumes** - Block storage over
NVMe over Fabrics (TCP) with optional DH-CHAP authentication."

**But it is explicitly, unambiguously RWO, with no RWX story at all** — unlike the iSCSI
feature line, the driver doesn't even offer a caveated RWX claim for NVMe-oF. Its own example
PVC (`examples/pvc-nvmeof.yaml`) spells this out in the file's own comments:

```yaml
# NVMe-oF/TCP PersistentVolumeClaim example
# Creates a ReadWriteOnce block volume backed by a ZVOL, exported over NVMe/TCP.
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: my-nvmeof-pvc
spec:
  accessModes:
    - ReadWriteOnce # NVMe-oF provides single-node block access
```

So: **NVMe-oF is a pure latency/throughput upgrade over iSCSI's identical RWO semantics; it
does not touch the RWO/`Recreate` story at all.** The same "old pod must fully detach before
the new pod's node can attach" gate this ticket is about applies identically whether the
underlying block transport is iSCSI or NVMe-oF/TCP — there's no NVMe-multipath/ANA-based
fast-failover angle here either, since a single-controller TrueNAS box (the case here; ALUA
and multi-controller NVMe multipathing are TrueNAS Enterprise HA-hardware features, see §3)
offers only one path to the volume in the first place.

On Talos specifically, this is one of the very few pieces of good news in this research:
Talos's kernel config (`siderolabs/pkgs`, `main`, kernel 6.18.44) has NVMe-oF/TCP
**initiator support built directly into the kernel, not even as a module**:

```
CONFIG_NVME_FABRICS=y
CONFIG_NVME_TCP=y
CONFIG_NVME_MULTIPATH=y
```

— in sharp contrast to iSCSI, which needs the `iscsi-tools`/`trident-iscsi-tools` Talos
system extensions to get the userspace `iscsid` daemon at all. If this cluster ever migrates
onto Talos, NVMe-oF volumes would need zero extra Talos-side extensions for the initiator
side (the driver's node DaemonSet still needs to load `nvme_tcp`/`nvme_fabrics`, which it can,
since they're compiled in). This makes NVMe-oF a genuinely low-risk, low-effort improvement to
adopt independent of anything else in this ticket — it's worth doing for the latency/IOPS win
alone, it doesn't require re-deciding anything about `Recreate`/downtime, and unlike GFS2/
OCFS2 it doesn't add any new operational surface (the TrueNAS-side setup is "enable the
NVMe-oF service," and the CSI driver already supports it — the only repo-side gaps are adding
an `nvmeofPortal` value to `apps/truenas-csi/deploy.yaml`'s ConfigMap and a
`truenas-nvmeof` `StorageClass`).

**Verdict: adopt for performance, but it does not solve the restart-downtime or scale-out
problem.**

## 3. TrueNAS-native fast-failover / multipath (ALUA)

**Source:** [TrueNAS Documentation Hub — Block Shares (iSCSI)](https://www.truenas.com/docs/scale/shares/iscsi/).

TrueNAS SCALE does document ALUA (Asymmetric Logical Unit Access):

> **Asymmetric Logical Unit Access (ALUA)**: ALUA allows a client computer to discover the
> best path to the storage on a TrueNAS system. HA storage clusters can provide multiple
> paths to the same storage. For example, the disks are directly connected to the primary
> computer and provide high speed and bandwidth when accessed through that primary computer.
> The same disks are also available through the secondary computer, but speed and bandwidth
> are restricted. With ALUA, clients automatically ask for and use the best path to the
> storage. If one of the TrueNAS HA computers becomes inaccessible, the clients automatically
> switch to the next best alternate path to the storage.

Critically, this entire section is inside a `TrueNAS Enterprise` callout in the source HTML
(`<blockquote class="gdoc-hint note">` tagged with a `TrueNAS Enterprise` badge, same styling
as the vCenter Plugin section immediately below it) — this is a **dual-controller HA hardware
feature**, gated to TrueNAS Enterprise appliances (the M/F/H/R-series with redundant
controllers), not something available on a Community Edition single-box NAS like the one this
cluster runs (`192.168.53.120`). And even where it is available, what it solves is "the NAS
itself has two redundant controller computers and a client should fail over between them" —
it is not a mechanism for two different _Kubernetes worker nodes_ to get fast, coordinated
access to the same LUN, and it does nothing about the actual bottleneck in this ticket, which
is Kubernetes' own attach/detach and pod-lifecycle sequencing (§4), not TrueNAS-side path
selection.

The `truenas-csi` driver's only related knob is node-side and unrelated to NAS failover: the
`iscsi.multipathEnabled` `StorageClass` parameter (`pkg/driver/iscsi.go`) enables Linux
`device-mapper-multipath` for redundant _network paths to the same single TrueNAS portal_ (NIC
bonding / dual-switch resilience), not failover between distinct NAS controllers or nodes.
`ControllerPublishVolume`/`ControllerUnpublishVolume` (§1) do no NAS-side attach bookkeeping at
all beyond looking up connection info, so there's no controller-side latency to shave in
the first place — the driver's part of the attach/detach path is already close to free.

**Verdict: not applicable.** ALUA requires TrueNAS Enterprise hardware this cluster doesn't
have and, even where available, solves a different problem (NAS controller redundancy) than
the one in this ticket (Kubernetes pod-rescheduling downtime). No fast-failover primitive
exists here to shorten the detach/reattach gap while staying RWO.

## 4. Kubernetes-level mitigations independent of the storage backend

**Sources:** [Kubernetes docs — Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/),
[Kubernetes docs — Pod Lifecycle](https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/),
[Kubernetes docs — Disruptions](https://kubernetes.io/docs/concepts/workloads/pods/disruptions/),
[Kubernetes docs — Persistent Volumes](https://kubernetes.io/docs/concepts/storage/persistent-volumes/),
[kubernetes-csi/external-attacher README](https://github.com/kubernetes-csi/external-attacher).

**`Recreate` itself is exactly as blunt as it looks.** Kubernetes' own docs are unambiguous:

> `.spec.strategy.type` can be "Recreate" or "RollingUpdate"... **All existing Pods are killed
> before new ones are created** when `.spec.strategy.type==Recreate`.

There's no partial/soft mode; this is what forces the full down-then-up cycle today.

**`terminationGracePeriodSeconds` is a real, if modest, lever.** The default is 30 seconds
(Pod Lifecycle docs); if the outgoing pod's process exits promptly on `SIGTERM` (true for
most of these lightweight single-process apps), lowering this doesn't reduce the theoretical
maximum wait, but it does reduce the _actual_ wait for well-behaved apps, since Kubernetes
proceeds as soon as the container exits rather than waiting out the full grace period.

**`PodDisruptionBudget` does not apply to this problem at all — this is explicit and
citable, not an inference.** From the Disruptions docs:

> Not all voluntary disruptions are constrained by Pod Disruption Budgets. For example,
> deleting deployments or pods bypasses Pod Disruption Budgets.

and, more directly:

> Pods which are deleted or unavailable due to a rolling upgrade to an application do count
> against the disruption budget, but **workload resources (such as Deployment and
> StatefulSet) are not limited by PDBs when doing rolling upgrades.** Instead, the handling of
> failures during application updates is configured in the spec for the specific workload
> resource.

PDBs govern _evictions_ (node drains, cluster-autoscaler defragmentation, `kubectl drain`) —
they have no jurisdiction over a Deployment/StatefulSet controller replacing its own pods
during a rollout, which is exactly the scenario at hand. This is a dead end for this specific
problem, not a partial win.

**CSI attach/detach timeout tuning matters for driver latency, not for this driver's actual
bottleneck.** The `external-attacher` sidecar (used by every CSI driver, including
`truenas-csi`) exposes `--timeout` (default 15s, timeout for each `ControllerPublish`/
`ControllerUnpublish` gRPC call), `--retry-interval-start`/`--retry-interval-max` (backoff
between retries), and `--worker-threads` (parallelism across `VolumeAttachment` objects) —
per the [external-attacher README](https://github.com/kubernetes-csi/external-attacher):

> `--timeout <duration>`: Timeout of all calls to CSI driver... 15 seconds is used by default.

These knobs help when the _driver's_ controller RPCs are slow or flaky. As established in §1,
`truenas-csi`'s `ControllerPublishVolume`/`ControllerUnpublishVolume` do no real attach/detach
work server-side (no TrueNAS API round-trip beyond a dataset lookup) — the actual iSCSI
session login happens node-side, in `NodeStageVolume`, gated by `iscsiRetryCount = 10`
login attempts at `iscsiCheckInterval = 1` second each (`pkg/driver/iscsi.go`) — worst case
~10 seconds to establish a fresh session on the new pod's node. So tuning attacher timeouts is
not the lever to pull here; the dominant costs are Kubernetes' own `Recreate` semantics (all
old pods must reach `Terminated` first), `terminationGracePeriodSeconds`, the new pod's
node-side iSCSI login (seconds, bounded), and the app's own startup/readiness-probe time —
none of which a CSI sidecar flag touches.

**The one genuinely useful, previously-unexploited Kubernetes-native lever: same-node
`ReadWriteOnce` reuse.** Kubernetes' own access-mode docs contain a nuance that's easy to
miss and directly relevant here:

> **ReadWriteOnce**: the volume can be mounted as read-write by a single node.
> **ReadWriteOnce access mode still can allow multiple pods to access (read from or write to)
> that volume when the pods are running on the same node.** For single pod access, please see
> ReadWriteOncePod.

`truenas-iscsi`'s RWO access mode restricts attachment to one _node_, not one _pod_. Reading
`truenas-csi`'s node plugin confirms this driver follows the standard CSI staging/publish
split that makes this work in practice: `NodeStageVolume` is idempotent (checks
`IsLikelyNotMountPoint` and returns immediately if the volume is already staged at that path)
and mounts the device once per node to a staging path; `NodePublishVolume` then bind-mounts
that staging path into each pod's own target directory (`pkg/driver/node.go`: "NodePublishVolume
bind-mounts the staged volume to the target path"). That means if — and only if — the outgoing
and incoming pod are scheduled to the _same_ node, a second pod can attach the already-staged
volume with no detach/reattach cost at all.

This suggests a genuinely low-risk experiment for the apps in this ticket that don't
strictly need to roam across nodes: pin the workload to a single node with `nodeAffinity`/
`nodeSelector`, and switch the Deployment from `strategy: Recreate` to `RollingUpdate` with
`maxSurge: 1, maxUnavailable: 0`. If it works as the generic CSI/Kubernetes model predicts,
this would give a genuinely near-zero-downtime restart on today's `truenas-iscsi` storage,
with **no new infrastructure, no driver change, no access-mode change at all**. Two honest
caveats: (1) this is inferred from reading Kubernetes' documented access-mode semantics and
this specific driver's source, not from an observed test in this cluster or from the driver's
own certification docs — its OpenShift certification manifest (§1) marks iSCSI
`singleNodeVolume: true`, which is consistent with (not evidence against) this working, but
it isn't a documented, tested guarantee either; it should be verified experimentally before
depending on it. (2) Pinning to one node forfeits the scheduling flexibility that's a good
part of the point of running a multi-node cluster — if that node is down for maintenance, the
app can't reschedule elsewhere, trading "downtime on every restart" for "downtime whenever
that one node is unavailable." It also doesn't touch the single-writer SQLite-safety question
at all (still one exclusive process on one filesystem, no RWX); it purely narrows the _restart_
downtime window, exactly the "restart-downtime half of the ask" framing from the ticket.

## 5. Is real horizontal scale-out possible against centralized storage at all?

**Sources:** [PostgreSQL docs — 26.1. Comparison of Different Solutions](https://www.postgresql.org/docs/current/different-replication-solutions.html),
[Redis docs — Scale with Redis Cluster](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/).

No — and PostgreSQL's own documentation settles this for the shared-storage case directly,
without needing to reason about `truenas-csi` at all. PostgreSQL's high-availability
comparison chapter includes "Shared Disk Failover" — the pattern of pointing multiple Postgres
servers at one centralized disk array/NAS — as one of its documented solutions, and is explicit
about what it does and doesn't buy:

> Shared disk failover avoids synchronization overhead by having only one copy of the
> database. It uses a single disk array that is shared by multiple servers. If the main
> database server fails, the standby server is able to mount and start the database as
> though it were recovering from a database crash. This allows rapid failover with no data
> loss. Shared hardware functionality is common in network storage devices... **One
> significant limitation of this method is that... the standby server should never access the
> shared storage while the primary server is running.**

Table 26.1 in that same doc (the "High Availability, Load Balancing, and Replication Feature
Matrix") lists `NAS` as the popular example under the "Shared Disk" column, and shows that
column with **no** checkmark under either "Allows multiple primary servers" or "Replicas
accept read-only queries" — i.e. by Postgres's own accounting, centralized/shared storage
buys failover (one standby that can start up _after_ the primary is confirmed gone), never
concurrent multi-writer scale-out and never even read-only load balancing. Real Postgres
scale-out — read replicas via streaming replication, which is how this project's own
`withPostgres` StatefulSets would need to grow if that were ever wanted — lives in a
completely different column of that same table ("Write-Ahead Log Shipping" /
"built-in streaming repl.," communication method "WAL," i.e. changes are shipped over the
Postgres replication _protocol_, not through a shared filesystem), and it requires **each
replica to have its own separate storage** (its own PVC, in Kubernetes terms) — RWX access to
one shared volume is neither used nor useful for this. `truenas-iscsi` RWO already supports
this pattern today, one PVC per StatefulSet replica; nothing about centralized-storage access
mode blocks it.

Redis Cluster is the same shape. From
[Redis's own scaling documentation](https://redis.io/docs/latest/operate/oss_and_stack/management/scaling/):

> Redis Cluster provides a way to run a Redis installation where data is automatically
> sharded across multiple Redis nodes... A minimal cluster that works as expected must
> contain at least three master nodes. For deployment, we strongly recommend a six-node
> cluster, with three masters and three replicas.

Redis Cluster scales horizontally by _sharding the keyspace across independent Redis
processes_, each with its own persisted dataset (its own AOF/RDB file, its own storage), and
replicating each shard to its own dedicated replica(s) over the Redis replication protocol —
not by having multiple Redis processes concurrently read/write one shared file. Centralized
NAS-hosted storage plays no special role here either way: each cluster node still wants its
own PVC, and the storage backend's RWX capability is simply irrelevant to whether Redis
Cluster horizontal scaling works.

**Verdict: confirmed exactly as the ticket anticipated, on primary sources rather than
repo-internal reasoning alone.** Storage-layer access mode (RWO vs. RWX) is orthogonal to
whether an app can scale out — Postgres and Redis both scale by running more independent
replicas, each with their own storage, coordinated at the application/protocol layer, not by
sharing one multi-attach volume. There is no storage-layer choice surveyed in this research
(or realistically available at all) that grants multi-writer scale-out to Postgres or Redis;
that capability is already fully theirs today, independent of `truenas-iscsi`'s RWO-ness, the
moment a `withPostgres`-style modifier is extended to provision N replica StatefulSets instead
of one. And for the embedded-SQLite apps specifically, there is no scale-out story at all,
on any storage backend — SQLite has no multi-writer clustering mode, full stop, so a
storage-layer change could — at best, and only in the ways ruled out above — address restart
downtime, never grant those apps something they structurally can't do.

## Recommendation

1. **Adopt now: add a `truenas-nvmeof` StorageClass and use NVMe-oF/TCP for new
   block-storage workloads.** It's a real, vendor-native (`nvmet_tcp`-backed), already-driver-
   supported latency/IOPS upgrade over iSCSI with the same operational shape as today's setup
   (one more `StorageClass`, `defaultPool: "tank"`, no new services beyond enabling NVMe-oF on
   the TrueNAS box and adding `nvmeofPortal` to `apps/truenas-csi/deploy.yaml`'s ConfigMap),
   and — unlike GFS2/OCFS2 — needs zero new Talos system extensions (`CONFIG_NVME_FABRICS=y`/
   `CONFIG_NVME_TCP=y` are already compiled into Talos's stock kernel). It does **not** change
   the `Recreate`/downtime story or unlock RWX/scale-out — it's purely a performance upgrade,
   worth doing on its own merits, not a fix for this ticket's actual pain.
2. **Worth a scoped, low-risk experiment: node-pinning + `RollingUpdate` for a subset of
   today's `withIscsiVolumes` apps**, per §4. This is the only path found in this research
   that could plausibly deliver a genuinely near-zero-downtime restart _without any new
   infrastructure at all_, on the storage already deployed today. It needs to be verified
   experimentally (attach a second pod to an already-staged `truenas-iscsi` volume on the same
   node and confirm clean behavior) before being relied on for anything the operator cares
   about, and it trades away cross-node scheduling flexibility for the pinned app — a real
   cost, but a bounded and well-understood one, unlike GFS2/OCFS2's operational overhead.
3. **Not viable: iSCSI RWX via GFS2/OCFS2.** Ruled out three independent ways: SQLite's own
   documentation makes WAL-mode databases architecturally incompatible with any multi-host
   filesystem (cluster-aware or not) — this is not a locking-quality problem a good cluster
   filesystem can fix; the DLM/Corosync/STONITH stack both filesystems require is a large new
   category of infrastructure disproportionate to a single-operator homelab even before
   counting the SQLite problem; and — decisively, independent of the other two — Talos (this
   repo's stated target cluster OS) ships a kernel with `GFS2_FS`, `OCFS2_FS`, and `DLM` all
   explicitly compiled out, with no system extension available to add them back. There is
   currently no supported path to this option on this cluster's actual or intended
   infrastructure.
4. **Not viable: ALUA / TrueNAS-native fast failover.** It's a TrueNAS Enterprise
   dual-controller-hardware feature this NAS doesn't have, and even on Enterprise hardware it
   solves NAS-controller redundancy, not Kubernetes pod-rescheduling latency. No TrueNAS-side
   fast-failover primitive exists to shorten today's detach/reattach gap while staying RWO.
5. **Not viable as a mitigation: `PodDisruptionBudget` and CSI attach/detach timeout
   tuning.** PDBs are explicitly documented as not governing Deployment/StatefulSet rollout
   replacement at all (only voluntary evictions/drains) — this is a dead end, not a partial
   win. Attacher timeout/retry tuning addresses driver-call latency that isn't this driver's
   bottleneck (its controller RPCs are already near-instant; the real costs are Kubernetes'
   own `Recreate` semantics, `terminationGracePeriodSeconds`, and node-side iSCSI login).
6. **Confirmed, not just assumed: storage-layer changes can only ever address restart
   downtime, never scale-out, for this fleet.** Postgres and Redis's own documentation confirm
   scale-out is achieved by running more independent, separately-stored replicas coordinated
   over an application-level replication protocol — centralized storage's access mode (RWO vs
   RWX) is orthogonal to that and already no obstacle to it today. The embedded-SQLite apps
   have no multi-writer scale-out story on any storage backend, full stop; if consistent write
   scale-out for one of them is ever genuinely needed, the fix is migrating that app's data
   model off embedded SQLite (e.g., onto a `withPostgres`-backed database), not a storage
   protocol change.
7. **Genuinely unresolved:**
   - Whether `truenas-csi`'s iSCSI node plugin actually behaves cleanly with two pods
     concurrently attached to one node's staged volume in practice — this was inferred from
     reading the driver's source and Kubernetes' documented access-mode semantics, not
     observed directly; it should be tested in a scratch namespace before any app depends on
     it.
   - Which of the ~9 embedded-SQLite apps run in WAL mode versus the legacy rollback-journal
     mode — this wasn't verified per-app here, and while it doesn't change the recommendation
     (GFS2/OCFS2 is ruled out on Talos-availability and operational-surface grounds
     regardless), it would matter if this cluster ever ends up somewhere GFS2/OCFS2 _is_
     available (e.g., a non-Talos node) and this question resurfaces.
   - Whether the node-pinning + `RollingUpdate` mitigation (item 2 above) is worth the
     scheduling-flexibility cost for any specific app in the current fleet — that's a
     per-app judgment call for whoever picks this up next, not something this research can
     settle in the abstract.
