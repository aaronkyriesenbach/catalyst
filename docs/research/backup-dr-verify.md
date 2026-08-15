# Research: Does the existing TrueNAS→B2 replication satisfy DR needs?

Ticket: [#26](https://github.com/aaronkyriesenbach/catalyst/issues/26) (part of wayfinder map #1)

## TL;DR

The repo's volsync/restic backup chain and the TrueNAS→B2 job protect against
**different, non-overlapping failure modes**, and neither one currently
covers "get workload data back after ransomware/corruption discovered days
later" with confidence — that depends entirely on config this agent cannot
inspect (see "Open questions" below).

- Restic repo backing volsync snapshots lives on the **same NAS**
  (`192.168.53.120`, `/mnt/tank/data`) as the primary workload PVCs. A NAS
  hardware failure or pool loss takes out both the primary data and the
  backup repo at the same time. This is the gap the B2 replication is meant
  to plug.
- TrueNAS's "Cloud Sync Task" (the feature used for TrueNAS↔B2 integration
  per Backblaze's own docs) is an **rclone-based sync/copy**, not a
  ZFS-snapshot-based replication. It mirrors the current file tree to B2 on
  a schedule; it is not equivalent to TrueNAS's ZFS-snapshot "Replication
  Task" feature (which is for TrueNAS-to-TrueNAS/CORE targets over SSH, not
  B2).
- Because Backblaze B2 supports file versioning, a Cloud Sync push job
  *can* survive local file corruption/ransomware — but **only if the B2
  bucket's lifecycle rules are configured to retain enough prior versions
  for enough days**, and only if the corruption is caught before those
  versions expire. If the bucket uses B2's "keep only the last version"
  default-ish behavior or a short `daysFromHidingToDeleting`, silent local
  corruption that syncs before detection will overwrite/hide the last good
  version and it will be purged on schedule.
- None of this can be confirmed from this environment — there is no access
  to the TrueNAS web UI/API to inspect the actual configured job. See "Open
  questions to check against your live TrueNAS config" below.

## What's actually backed up today (from the repo)

Source: `backup.ts`, `apps/restic-server.ts`, `apps/volsync.ts`,
`modifiers.ts` in `aaronkyriesenbach/catalyst`.

- **Mechanism**: VolSync `ReplicationSource` CRs (`volsync.backube/v1alpha1`)
  with `copyMethod: Snapshot` and the `restic` mover, defined per-PVC via
  `buildBackupResources()` in `backup.ts`. Currently used by:
  - `apps/immich.ts` → PVC `data-immich-postgres-0`
  - `apps/pocket-id.ts` → PVC `pocket-id-data`
  - (any other app calling `withPostgres`/`buildBackupResources` — search
    `buildBackupResources` in `apps/` for the current full list at any given
    time)
- **Schedule (RPO)**: `DEFAULT_SCHEDULE = dailyAt(3)` — daily at 03:00,
  unless an app overrides `options.schedule`. So RPO is roughly 24 hours
  for anything using the default.
- **Retention**: `DEFAULT_RETAIN = { daily: 7, weekly: 4, monthly: 2 }`
  (restic `--keep-daily/--keep-weekly/--keep-monthly` semantics), with
  `pruneIntervalDays: 14` — i.e., restic prune runs roughly every two weeks
  to actually reclaim space per the retention policy. Retention gives
  point-in-time recovery within that window (e.g., undo ransomware/corruption
  discovered within the last ~2 months, assuming prune hasn't already
  removed the relevant snapshot).
- **Restic repository target**: `restic-server` (`apps/restic-server.ts`)
  runs `restic/rest-server` with `--no-auth`, and mounts NAS storage via
  `withNasMounts({ main: [{ mountPath: "/data", subPath: "backups/volsync" }] })`.
  `withNasMounts`/`modifiers.ts` hardcodes the NFS server as
  `NAS_SERVER = "192.168.53.120"`, `NAS_PATH = "/mnt/tank/data"` — i.e. the
  restic repo lives at `192.168.53.120:/mnt/tank/data/backups/volsync`.
- **Primary workload storage**: PVCs use `storageClassName: "truenas-iscsi"`
  (see `backup.ts` `DEFAULT_STORAGE_CLASS`, and `storage.ts` which also
  hardcodes `DEFAULT_NAS_IP = "192.168.53.120"`) — i.e., the primary
  workload data and the restic backup repository are both physically hosted
  on the same TrueNAS box, just via different protocols (iSCSI for
  workloads, NFS for the restic repo). **This confirms the single point of
  failure**: a full pool/hardware loss on that NAS destroys the primary data
  and the restic repo in the same event.

## How TrueNAS SCALE's B2 integration actually works (primary source: TrueNAS/Backblaze docs)

TrueNAS SCALE has two distinct data-protection features that are easy to
conflate:

1. **Cloud Sync Tasks** — the feature used to talk to Backblaze B2 (and S3,
   Dropbox, SFTP, etc.). Per TrueNAS's own docs:
   > "TrueNAS can send, receive, or synchronize data with a cloud storage
   > provider. Cloud sync tasks allow for single-time transfers or recurring
   > transfers on a schedule." Supported providers include Backblaze B2.
   (TrueNAS Docs, *Cloud Sync Tasks*,
   https://www.truenas.com/docs/scale/24.04/scaletutorials/dataprotection/cloudsynctasks/)

   This is **rclone under the hood**, doing file-tree sync/copy against
   whatever local directory/dataset you point it at — it is *not* ZFS
   snapshot send/receive. Its `Transfer Mode` options are Sync / Copy;
   `Sync` "keeps all the files identical between the two storage locations"
   and does not, by itself, retain history on the source side beyond
   whatever the destination's versioning provides.

   TrueNAS's own docs call out a B2-specific behavior directly:
   > "Syncing to a Backblaze B2 bucket does not delete files from the
   > bucket, even after deleting those files locally. Instead, files are
   > tagged with a version number or moved to a hidden state. To
   > automatically delete old or unwanted files from the bucket, adjust
   > the Backblaze B2 Lifecycle Rules."
   (same TrueNAS doc as above)

   This means: whether old/replaced versions in B2 are kept long enough to
   recover from corruption is **entirely a function of the B2 bucket's
   Lifecycle Rules**, not of anything TrueNAS itself is guaranteeing.

2. **Replication Tasks** — TrueNAS's ZFS-snapshot-based replication,
   which is what actually gives point-in-time, incremental, snapshot-level
   backups. Per TrueNAS's own docs:
   > "TrueNAS SCALE replication allows users to create one-time or
   > regularly scheduled snapshots of data stored in pools, datasets or
   > zvols on their SCALE system as a way to back up stored data... Remote
   > replication can occur between your TrueNAS SCALE system and another
   > TrueNAS system (SCALE or CORE)... The first snapshot taken for a task
   > creates a full file system snapshot, and all subsequent snapshots
   > taken for that task are incremental."
   (TrueNAS Docs, *Setting Up a Remote Replication Task*,
   https://www.truenas.com/docs/scale/24.04/scaletutorials/dataprotection/replication/remotereplicationscale/)

   Critically, **Replication Tasks target another TrueNAS (SCALE or CORE)
   system over SSH** — this feature is not documented as a way to replicate
   to Backblaze B2 or any generic S3/object-storage target. Backblaze's own
   integration guide for TrueNAS confirms the B2 side is done via **Cloud
   Sync Task**, not Replication Task:
   > "Select Tasks, then select Cloud Sync Tasks. Click Add... Select Push
   > as the Direction. Select Sync as the Transfer Mode..."
   (Backblaze Docs, *How to Set Up TrueNAS Cloud Backup with Backblaze B2
   Cloud Storage*,
   https://www.backblaze.com/docs/cloud-storage-integrate-truenas-with-backblaze-b2)

**Conclusion**: unless something unusual is configured, the TrueNAS→B2 job
is very likely a **Cloud Sync Task** (rclone sync/copy), not a
ZFS-snapshot-based replication. That means:
- It protects against **hardware/pool loss** (an off-site copy exists).
- It does **not**, by itself, provide point-in-time recovery beyond what B2
  bucket versioning + lifecycle rules give it — and TrueNAS's Cloud Sync
  Task has no native concept of "restic snapshot" or "ZFS snapshot" that
  would let you roll back to an arbitrary prior point independent of B2's
  own version history.

## What Backblaze B2 actually offers for versioning/retention (primary source: Backblaze docs)

- **File Versions**: B2 keeps every version of a file you overwrite by
  default, forever, unless you configure otherwise or explicitly delete a
  version:
  > "By default, Backblaze B2 retains all of the files that you upload and
  > all of the different versions of the files that you upload... There is
  > no limit to the number of versions you can have of a given file. By
  > default, older versions are kept forever, unless you delete them or you
  > stop using the Backblaze B2 service."
  (Backblaze Docs, *File Versions*,
  https://www.backblaze.com/docs/cloud-storage-file-versions)

  When a sync tool re-uploads a file with the same name, the old version is
  not deleted — it's "hidden" (marked as no longer the current version) but
  still recoverable by file ID, unless a Lifecycle Rule purges it:
  > "The b2_hide_file operation makes it look like the file has been
  > deleted, without removing any of the history... you can use the
  > b2_delete_file_version operation to delete file versions; however
  > deleting a file version cannot be undone."
  (same source)

- **Lifecycle Rules control retention of those old/hidden versions.** By
  default (no rules), B2 keeps everything forever, which is safe for DR but
  costs money and can degrade performance at scale:
  > "While versioning provides valuable protection against accidental
  > deletions and overwrites, uploading millions of versions of the same
  > object into a bucket may significantly degrade performance of object
  > deletion and listing operations, increase the rate of HTTP 503... To
  > avoid this, configure lifecycle rules to automatically expire old
  > versions after a specified number of days or limit the number of
  > retained versions per object."
  (Backblaze Docs, *Automate File Deletion with Backblaze B2 Lifecycle
  Rules*, https://www.backblaze.com/docs/cloud-storage-lifecycle-rules)

  The three practical presets exposed in the B2 web console (per the same
  doc) are:
  1. **Keep all versions of the file** (default) — no expiry; safest for
     DR/ransomware recovery, but unbounded storage growth.
  2. **Keep only the last version of the file** — previous version is
     hidden for **1 day** then deleted. This is effectively **useless
     against ransomware/corruption** discovered more than a day after the
     bad sync, because the last-known-good version will already be purged.
  3. **Keep prior versions for N days** — `daysFromHidingToDeleting: N`;
     current version is always kept, prior versions purged N days after
     being superseded/hidden. Recovery window = N days from when the bad
     file was uploaded/replaced.

  Lifecycle rules run **once per day**, and time windows are computed from
  the **upload timestamp**, not detection time — so the practical recovery
  window for "sync happened, then ransomware/corruption discovered later"
  is bounded by whatever `daysFromHidingToDeleting` is set to, counting from
  the sync date, not the discovery date. (Backblaze Docs, *Automate File
  Deletion with Backblaze B2 Lifecycle Rules*, "Setting Times for Lifecycle
  Rules" section, same URL as above.)

- B2 also supports **Object Lock** (WORM-style immutability for a
  configured retention period), which — per Backblaze's docs — overrides
  lifecycle-rule deletion for locked versions:
  > "Lifecycle Rules potentially delete specific versions of files.
  > However, if the file version to which the rule applies has Object Lock
  > enabled, then the deletion does not occur."
  (same source, "Object Lock and Lifecycle Rules" section). This is
  relevant if ransomware-resistance against an attacker with B2 credentials
  is a concern — a compromised Cloud Sync API key could otherwise
  overwrite/hide/delete the same versions it's protecting.

## Assessment against the DR requirement

| Failure mode | Covered by restic/volsync (on-NAS repo)? | Covered by TrueNAS→B2 job? |
|---|---|---|
| Accidental delete/overwrite in a workload, caught within retention window | Yes (`daily:7, weekly:4, monthly:2`, ~pruned every 14 days) | Only if B2 lifecycle rules retain enough prior versions long enough — **unconfirmed** |
| NAS pool/hardware failure (entire `192.168.53.120` box lost) | **No** — repo lives on the same NAS | Yes, *if* the B2 push job is actually running successfully and includes the right paths — **unconfirmed** |
| Ransomware/corruption that also touches or encrypts the restic-repo mount (same NAS, reachable over NFS) | **No** — same NAS, same blast radius | Possibly, but only within the B2 lifecycle-rule retention window from the time of corruption, and only if B2 credentials weren't also compromised (no Object Lock confirmed) |
| Site loss (fire/theft of the whole rack) | **No** — no off-site copy in the volsync chain itself | Yes, if the B2 job is truly off-site and functioning |

The TrueNAS→B2 job is the **only** off-site leg in this whole chain today.
Whether it's *sufficient* depends entirely on facts not visible from this
repo or this environment.

## Limitations of this research

This agent has **no access to the TrueNAS web UI or API** in this
environment, so it cannot inspect:
- Which TrueNAS feature the existing job actually uses (Cloud Sync Task vs.
  something else).
- What local path/dataset the job pushes (does it include
  `/mnt/tank/data/backups/volsync`, i.e. the restic repo itself, or just
  raw dataset snapshots, or something else entirely?).
- The job's schedule/frequency.
- The destination B2 bucket's Lifecycle Rules configuration.
- Whether Object Lock is enabled on that bucket.
- Whether the B2 application key used has write-only or read/write access
  (a compromised read/write key could let ransomware or an attacker also
  wipe the off-site copies within the lifecycle window).

All claims above about TrueNAS/Backblaze *product behavior* are grounded in
the primary docs cited; claims about *this specific homelab's job config*
are explicitly flagged as unconfirmed.

## Open questions to check against your live TrueNAS config

To determine actual sufficiency, check the following in the TrueNAS SCALE
UI (`Data Protection` page) and Backblaze web console:

1. **Which feature is the job?** Under `Data Protection`, is it listed as a
   **Cloud Sync Task** or something else? (Per Backblaze's own TrueNAS
   integration guide, B2 integration is done via Cloud Sync Task — if
   yours is different, re-verify the analysis above.)
2. **What path does it sync?** Does the Cloud Sync Task's local
   `Directory/Files` include `/mnt/tank/data/backups/volsync` (the restic
   repository `restic-server` writes to)? If it only covers other
   datasets, the restic repo itself has no off-site copy regardless of how
   well-tuned the B2 side is.
3. **Transfer Mode**: `Sync` or `Copy`? (`Sync` deletes B2-side files that
   no longer exist locally — but per TrueNAS's own docs, B2 uploads are
   never truly deleted, only hidden and subject to lifecycle rules, so
   `Sync` mode's local deletes still rely on the same lifecycle-rule
   retention window to avoid permanent loss.)
4. **Schedule** — how often does the job actually run? This sets the
   RPO for the off-site copy, and must be compared against the volsync
   schedule (daily at 03:00) — if the B2 job runs less frequently, the
   worst-case off-site RPO is longer than 24h.
5. **B2 bucket Lifecycle Rules** — go to the B2 bucket → `Lifecycle
   Settings`. Is it "Keep all versions" (safe but unbounded cost), "Keep
   only the last version" (effectively **no** ransomware protection —
   1-day purge), or a custom `daysFromHidingToDeleting` N? What is N, and
   is it long enough to notice and respond to corruption/ransomware before
   the last-good version is purged?
6. **Object Lock** — is it enabled on the bucket? If not, and if the same
   B2 application key used by the Cloud Sync Task has delete/overwrite
   permissions, an attacker or ransomware process with access to the
   TrueNAS box (and thus its stored B2 credentials) could purge the
   off-site history within the lifecycle window, defeating the DR purpose.
   Consider a write-only/no-delete-permission app key plus Object Lock if
   ransomware resistance (not just hardware-loss resistance) is a hard
   requirement.
7. **Restore testing** — has a restore ever actually been performed from
   the B2 copy (of either the restic repo or the raw datasets)? None of the
   above matters if the data can't actually be pulled back down and used.
8. **Job health/monitoring** — is there alerting if the Cloud Sync Task
   fails or hasn't completed successfully in N days? An off-site copy that
   silently stopped running provides no protection at the moment it's
   needed.

## Sources

- TrueNAS Docs, *Cloud Sync Tasks* (SCALE 24.04):
  https://www.truenas.com/docs/scale/24.04/scaletutorials/dataprotection/cloudsynctasks/
- TrueNAS Docs, *Setting Up a Remote Replication Task* (SCALE 24.04):
  https://www.truenas.com/docs/scale/24.04/scaletutorials/dataprotection/replication/remotereplicationscale/
- Backblaze Docs, *How to Set Up TrueNAS Cloud Backup with Backblaze B2
  Cloud Storage*:
  https://www.backblaze.com/docs/cloud-storage-integrate-truenas-with-backblaze-b2
- Backblaze Docs, *File Versions*:
  https://www.backblaze.com/docs/cloud-storage-file-versions
- Backblaze Docs, *Automate File Deletion with Backblaze B2 Lifecycle
  Rules*: https://www.backblaze.com/docs/cloud-storage-lifecycle-rules
- Repo: `backup.ts`, `apps/restic-server.ts`, `apps/volsync.ts`,
  `modifiers.ts`, `storage.ts` in `aaronkyriesenbach/catalyst`
  (read at commit checked out in `research/backup-dr-verify` worktree).
