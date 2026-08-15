# Research: Postgres/Redis-as-a-service operator options

Ticket: [#24](https://github.com/aaronkyriesenbach/catalyst/issues/24), part of the
"Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

Scope: survey CloudNativePG, Zalando Postgres Operator, Crunchy PGO, Redis
operators, and shared-vs-per-app provisioning models, against the current
ad hoc `withPostgres` pattern. All claims below are cited to the primary
project source that owns them (official docs/READMEs/source, not blog
write-ups).

## Current state: `withPostgres` in `modifiers.ts`

Read directly from `/home/aaron/repos/catalyst/modifiers.ts` (as of this
research):

- `withPostgres(version, options?)` is a `WorkloadModifier` that, per app,
  builds a **separate `StatefulSet`** named `<app>-postgres` with a single
  `postgres` container (not an init container — the container runs
  `postgres` itself, listening on 5432, with `pg_isready`-based startup/
  readiness probes) plus a headless `Service`.
- Storage is a `PersistentVolumeClaim` **template** built by
  `buildIscsiPvcTemplate` (`utils.ts`), which requests a `truenas-iscsi`
  storage-class PVC (`ReadWriteOnce`, default `10Gi`) — **not** the shared
  NFS-backed `nas` volume used by `withNasMounts`. Each app's Postgres gets
  its own dedicated iSCSI-backed PVC.
- Image defaults to `docker.int.lab53.net/library/postgres:<version>-<variant>`
  (mirrors Docker Hub `library/postgres`), variant one of `alpine`/
  `bookworm`/`trixie`.
- `POSTGRES_USER`/`PASSWORD`/`DB` env vars default to the app name; no HA,
  no replication, no PITR — a single instance per app.
- Optional `options.backup` wires in `buildBackupResources` (a
  separate backup subsystem, out of scope here) targeting the PVC.
- There is **no central operator**: every app that calls `withPostgres`
  gets its own independent StatefulSet, Service, and PVC, hand-rolled by
  this modifier. Nothing supervises failover, backups (unless opted in),
  minor-version patching, or credential rotation across apps.

(Note: the repo's `AGENTS.md` describes `withPostgres` as adding Postgres
"as an init container with NAS-backed data" — that description does not
match the current code, which uses a dedicated StatefulSet with an
iSCSI-backed PVC, not the shared NFS-backed `nas` volume or an init
container. Flagging the discrepancy for whoever maintains that doc.)

## CloudNativePG (CNPG)

Source: [cloudnative-pg.io/docs](https://cloudnative-pg.io/docs/devel) (official docs, Docusaurus site).

- **What it is**: "an open-source operator designed to manage PostgreSQL
  workloads on any supported Kubernetes cluster," introducing a `Cluster`
  CRD representing one primary + optional replicas. Originally built by
  EDB, released under **Apache License 2.0**; is a **CNCF Sandbox
  project**. ([Overview](https://cloudnative-pg.io/docs/devel))
- **Architecture**: CNPG does **not** use StatefulSets — it directly
  manages PVCs via a custom pod controller, one Postgres `Cluster` CR per
  logical database cluster. Recommends a shared-nothing design: each
  instance on a different node/AZ, one instance = one Pod = one PVC.
  ([Architecture](https://cloudnative-pg.io/docs/devel/architecture), [Overview](https://cloudnative-pg.io/docs/devel))
- **HA/replication**: built-in automated failover via a per-cluster
  Kubernetes `Lease` (avoids split-brain/premature promotion, new in
  1.30), quorum- or priority-based synchronous replication, self-healing
  replica recreation, planned switchover. Uses PostgreSQL's native
  streaming/WAL-shipping replication rather than storage-level
  replication. ([Overview](https://cloudnative-pg.io/docs/devel); [Architecture](https://cloudnative-pg.io/docs/devel/architecture))
- **Backup/PITR**: pluggable "CNPG-I" backup/recovery architecture; the
  community-maintained Barman Cloud plugin does WAL archiving + full/PITR
  recovery to object stores; volume-snapshot-based backup/recovery is
  supported natively if the storage class supports it.
  ([Overview](https://cloudnative-pg.io/docs/devel))
- **Connection pooling**: native PgBouncer integration via a `Pooler` CRD.
  ([Overview](https://cloudnative-pg.io/docs/devel))
- **Multi-tenancy / one-cluster-per-app model**: CNPG's unit of management
  is the `Cluster` CR — one CR = one isolated Postgres instance (with its
  own PVC-per-instance, its own primary/replicas). There is no concept of
  "one shared Postgres serving many apps" built into the CRD; the
  idiomatic pattern is **one `Cluster` per application/tenant**, with the
  operator centrally handling lifecycle (upgrades, failover, backups,
  role/db/extension management) for all of them. Declarative role,
  database, extension, and tablespace management is built into the
  `Cluster` spec. ([Overview](https://cloudnative-pg.io/docs/devel))
- **Install**: single YAML manifest, Helm chart, `cnpg` kubectl plugin, or
  OLM; operator itself runs as one Deployment (`cnpg-system` namespace),
  supports leader-election HA if scaled to multiple replicas.
  ([Installation and upgrades](https://cloudnative-pg.io/docs/devel/installation_upgrade))
- **Images**: community-maintained Postgres "operand" images
  (`ghcr.io/cloudnative-pg/postgresql`) built on Debian slim, signed with
  SBOM/provenance, for all Debian-supported PGDG-supported Postgres
  versions; default in the docs is Postgres 18.
  ([Overview](https://cloudnative-pg.io/docs/devel))
- **Release cadence**: monthly-ish minor releases; strongly recommends
  staying current for CVE fixes (two CVEs and a Lease-based security
  hardening landed in 1.30.0 at time of writing).
  ([Installation and upgrades](https://cloudnative-pg.io/docs/devel/installation_upgrade))

## Zalando Postgres Operator

Source: [github.com/zalando/postgres-operator](https://raw.githubusercontent.com/zalando/postgres-operator/master/README.md) README and docs (`docs/user.md`, `docs/administrator.md`).

- **What it is**: "delivers an easy to run highly-available PostgreSQL
  clusters on Kubernetes powered by Patroni," configured entirely through
  a `postgresql` CRD manifest. In production at Zalando "for over five
  years." (README)
- **HA mechanism**: delegates leader election/failover to **Patroni**
  (the well-known DCS-based HA agent), not a custom Kubernetes-native
  controller loop like CNPG's Lease approach. (README)
- **Features**: rolling updates, live volume resize without pod restart
  (AWS EBS/PVC), PgBouncer connection pooling, fast in-place major-version
  upgrades (including a "global upgrade of all clusters" mode), cloning/
  restore from AWS/GCS/Azure, logical backups to S3/GCS, standby clusters
  from WAL archive or remote host, basic credential/user management, a
  web UI for creating/editing Postgres manifests, custom TLS certs,
  OpenShift compatibility, multi-arch images. (README)
- **Postgres version support**: v2.0.1 supports Postgres 14→18 on
  Kubernetes 1.27+. (README)
- **Extensions bundled via Spilo**: ships with a large curated set
  preloaded/available, e.g. `pgvector`, `pg_cron`, `pg_partman`,
  `pg_repack`, `postgis`, `timescaledb`, `pgaudit`, `decoderbufs`
  (Debezium CDC), etc. — notably broader out-of-the-box extension
  coverage than CNPG's minimal/standard operand images. (README)
- **Connection pooler model**: operator can create a "database side
  connection pooler" (PgBouncer) per cluster, for either the master
  service, replica service, or both, configured via a `connectionPooler`
  stanza on the manifest — one pooler deployment per Postgres cluster, not
  shared across clusters. (`docs/user.md`)
- **Multi-tenancy model**: same as CNPG — the operator's unit is one
  `postgresql` CR = one isolated HA cluster (its own Patroni-managed
  StatefulSet, its own storage). No native shared-instance/multi-tenant
  database-as-a-service concept; "one Postgres cluster per app" is the
  idiomatic pattern here too.
- **Install**: Helm chart, Kustomize, or plain manifests; migration docs
  exist for v1→v2 operator upgrades. (README)

## Crunchy PGO (Postgres Operator from Crunchy Data)

Source: [access.crunchydata.com/documentation/postgres-operator](https://access.crunchydata.com/documentation/postgres-operator/latest/) (official docs) and [github.com/CrunchyData/postgres-operator](https://raw.githubusercontent.com/CrunchyData/postgres-operator/master/README.md) README/LICENSE.

- **What it is**: "PGO... gives you a declarative Postgres solution that
  automatically manages your PostgreSQL clusters," built around a
  `postgresclusters.postgres-operator.crunchydata.com` CRD. The **PGO
  operator source itself is Apache License 2.0** (`LICENSE.md`), and it
  is the open-source engine behind Crunchy's commercial "Crunchy Postgres
  for Kubernetes" product. (README; Detailed Architecture page)
- **Architecture**: PGO uses **Kubernetes StatefulSets** for Postgres
  instances and Deployments for more ephemeral pieces (pgBackRest repo
  host, optional PgBouncer). HA is delegated to a "distributed-consensus"
  mechanism (Patroni-based) so the operator is not a SPOF for failover
  decisions — same philosophy as Zalando's Patroni approach, different
  from CNPG's operator-mediated Lease approach.
  ([Detailed Architecture](https://access.crunchydata.com/documentation/postgres-operator/latest/architecture/))
- **Backup/DR**: uses **pgBackRest** for full/incremental/differential
  backups and delta restores, to local storage, S3, GCS, or Azure, with
  configurable retention; supports standby/cloning across clusters and
  across Kubernetes clusters. (README)
- **Other features**: enforced TLS on all connections (BYO-TLS
  supported), pgMonitor-based monitoring (Prometheus/Grafana/
  Alertmanager), rolling PostgreSQL updates, sync/async replication,
  cluster cloning, PgBouncer pooling, pod anti-affinity/node affinity/
  tolerations, resize-in-place, custom image repos, namespace scoping.
  (README)
- **Important licensing wrinkle for a homelab**: PGO's own code is
  Apache-2.0, but the README's default install instructions pull
  **Crunchy's own container images** ("Crunchy Postgres", "Crunchy
  Postgres for Kubernetes") from the Crunchy Data Developer Portal, which
  are subject to the **Crunchy Data Developer Program Terms of Use** —
  not a plain open-source registry pull. Using PGO with different
  (community) Postgres images "will require modifications of these
  installation instructions and creation of the necessary PostgreSQL and
  related containers" — i.e., more manual work than CNPG/Zalando to run
  fully outside Crunchy's distribution. (README, "Installation" and
  "FAQs, License and Terms" sections)
- **Multi-tenancy model**: same shape as CNPG/Zalando — one
  `PostgresCluster` CR per isolated cluster; no shared-instance concept
  built in.

## Redis operators

There is no Postgres-operator-style consensus pick for Redis; options
split by license/complexity.

### Spotahome redis-operator

Source: [github.com/spotahome/redis-operator](https://raw.githubusercontent.com/spotahome/redis-operator/master/README.md) README, [LICENSE](https://raw.githubusercontent.com/spotahome/redis-operator/master/LICENSE).

- **License**: Apache License 2.0.
- **What it manages**: a `RedisFailover` CRD — Redis in primary/replica
  mode plus **Sentinel** for automated failover (not Redis Cluster mode).
  Creates a Redis StatefulSet (`rfr-<name>`), a Sentinel Deployment +
  Service (`rfs-<name>`), and ConfigMaps. Clients need a
  Sentinel-aware Redis client library, connecting to `rfs-<name>:26379`
  with a `master-name` of `mymaster`. (README)
- **Persistence**: `emptyDir` by default (no persistence!) unless you
  explicitly add a PVC spec under `spec.storage`. (README)
- **Extras**: node affinity/anti-affinity/topology-spread-constraints,
  custom Redis/Sentinel config via `customConfig` (applied live via
  `CONFIG SET`, not written to `redis.conf`), auth via a
  `secretPath`-referenced Secret, bootstrapping/migration from an existing
  Redis instance via `bootstrapNode`. (README)
- **Multi-tenancy model**: one `RedisFailover` CR = one isolated
  primary/replica/Sentinel group; no shared-instance concept.
- Actively maintained, Kubernetes 1.25–1.27 and Redis 6+ tested at time of
  reading. (README)

### OT-CONTAINER-KIT redis-operator

Source: [github.com/OT-CONTAINER-KIT/redis-operator](https://raw.githubusercontent.com/OT-CONTAINER-KIT/redis-operator/main/README.md) README (maintained by OpsTree Solutions).

- **License**: Apache 2.0 (per README badge).
- **What it manages**: broader mode coverage than Spotahome's operator —
  **standalone, cluster, replication, and Sentinel** Redis topologies from
  one operator, plus Redis Cluster failover/recovery, built-in
  `redis-exporter` monitoring, password/passwordless setup, TLS, IPv4/
  IPv6 support, and a Grafana dashboard. (README)
- **Images**: `quay.io/opstree/redis`, `quay.io/opstree/redis-sentinel`,
  `quay.io/opstree/redis-exporter` — OpsTree-maintained, not upstream
  Redis Inc images. Supports Redis `>=6`. (README)
- **Multi-tenancy model**: same as Spotahome — one CR per Redis
  topology instance, no shared-instance abstraction.
- Full docs at redis-operator.opstree.dev (not fetched here; README was
  sufficient for scope/feature comparison).

### Redis Enterprise for Kubernetes (Redis Inc.)

Source: [redis.io/docs/latest/operate/kubernetes/](https://redis.io/docs/latest/operate/kubernetes/) (official Redis Inc. docs).

- **What it is**: the commercial "Redis Enterprise" product's Kubernetes
  operator, introducing `RedisEnterpriseCluster` (REC) and
  `RedisEnterpriseDatabase` (REDB) CRDs. REC = the cluster/nodes; REDB =
  an individual database *inside* that cluster. (docs)
- **This is the one operator here with an explicit shared-instance
  model**: a single REC (Redis Enterprise cluster) is provisioned once,
  and then many REDB (database) resources are created against it —
  closer to a genuine "Redis-as-a-service" model where apps request a
  database from a shared cluster rather than each getting a dedicated
  Redis process. (docs)
- **Features**: linear scalability via Redis clustering, HA/automatic
  failover, Active-Active geo-distribution, "Redis Flex" for cost
  optimization, enterprise security/encryption, 24/7 support (commercial
  support, not free). (docs)
- **Licensing/cost**: this is Redis Inc.'s commercial "Redis Software"
  product; the operator/CRDs are how you run it on Kubernetes, but the
  underlying Redis Enterprise software has its own commercial licensing —
  not a free-tier-first fit for a homelab without further licensing
  research beyond this scope. Flagging as the "shared-instance done
  properly" reference model rather than a direct recommendation.

## Shared-instance vs. per-app-instance provisioning models

The current `withPostgres` modifier and all three Postgres operators
surveyed (CNPG, Zalando, Crunchy PGO) default to **one dedicated
database-cluster-per-app**: one `Cluster`/`postgresql`/`PostgresCluster`
CR, its own compute, its own storage, its own credentials. None of the
three Postgres operators has a built-in "provision me a database inside
an existing shared cluster" primitive analogous to Redis Enterprise's
REC/REDB split — CNPG, Zalando, and PGO's declarative role/database
management (see CNPG's `Overview`, "Databases, extensions, schemas...")
lets you manage *multiple databases inside one `Cluster`* by hand, which
is the closest any of them get to "shared instance," but it's a manual
composition, not a first-class multi-tenant provisioning API.

Tradeoffs, given this repo's context (single-operator homelab, apps are
independent, NAS/iSCSI storage is finite and per-PV):

- **Per-app instance (what CNPG/Zalando/PGO all encourage by default)**
  - ✅ Blast-radius isolation: one app's bad migration, credential leak,
    or extension crash cannot touch another app's data.
  - ✅ Independent lifecycle: each app can pin its own Postgres major
    version and upgrade on its own schedule.
  - ✅ Matches the existing `WorkloadApp` mental model in this repo — one
    modifier call per app already assumes "this app owns its Postgres."
  - ❌ More overhead per app: N StatefulSets/Pods/PVCs for N apps, more
    idle memory/CPU reserved by N postmaster processes, more iSCSI PVCs
    to track on the NAS.
  - ❌ N operators-worth of "small" backups/monitoring/credentials to
    wire up (mitigated by the operator handling it centrally instead of
    hand-rolled per app, as today).
- **Shared instance (many databases/roles inside one cluster, or Redis
  Enterprise's REC+REDB model)**
  - ✅ Lower fixed overhead: one HA Postgres cluster (or one Redis
    Enterprise cluster) serving many apps means one process/pod set to
    keep warm instead of N.
  - ✅ Centralizes patching/monitoring/backup config to one target.
  - ❌ Blast radius: a bad `ALTER ROLE`, runaway query, or storage
    exhaustion from one app can degrade or take down every other app
    sharing the instance.
  - ❌ Version coupling: every tenant is stuck on the same Postgres major
    version and the same set of preloaded extensions.
  - ❌ None of CNPG/Zalando/PGO ship a first-class "hand me a tenant
    database" CRD the way Redis Enterprise's REDB does — you'd be
    manually managing `managed.databases`/roles inside one `Cluster` spec
    and building your own app-facing convention on top, which reintroduces
    some of the hand-rolling this research is meant to move away from.

For a homelab of this size (per `AGENTS.md`, apps are added ad hoc,
one at a time, via a discoverable `apps/*.ts` file each), **per-app
instances remain the better default** even with a central operator: the
isolation and independent-upgrade properties matter more here than the
resource savings of pooling, and per-app instances are what all three
Postgres operators are actually designed and documented around. Shared
instances are worth revisiting only if the number of low-traffic apps
grows large enough that per-app Postgres pods become a meaningful
resource-pressure problem on the cluster.

## Recommendation

- **Adopt CloudNativePG** as the central Postgres operator to replace
  `withPostgres`'s hand-rolled StatefulSet:
  - Apache-2.0, CNCF Sandbox project, no commercial-image licensing
    entanglement (unlike Crunchy PGO's default Developer Program images) —
    cleanest fit for "free-tier-first."
  - Actively maintained with frequent releases and a clear security
    posture (CVE fixes, safe primary election via Lease) — more assurance
    for a homelab that won't have dedicated DBA staff watching it.
  - Simplest operational model of the three: no separate Patroni/DCS
    layer to reason about (unlike Zalando/PGO, which both delegate HA to
    Patroni) — the operator directly manages failover via a Kubernetes
    Lease, which is one less moving part to run in a single-operator
    homelab.
  - Native `Pooler` (PgBouncer) CRD and native volume-snapshot backup
    support map cleanly onto this repo's existing iSCSI/`truenas-iscsi`
    storage class and existing `buildBackupResources` pattern.
  - Trade-off to note: CNPG's built-in Postgres operand images are more
    minimal than Zalando's Spilo-based images (fewer preloaded
    extensions like `pgvector`/`pg_cron`/`postgis` out of the box) — if
    an app needs one of those, plan to build/select a custom operand
    image (CNPG explicitly supports bringing your own operand image).
  - Keep `withPostgres`'s per-app-instance shape (one `Cluster` per app)
    when migrating — it matches how every operator surveyed expects to
    be used, and matches this repo's existing `WorkloadModifier`
    per-app pattern.
- **Do not adopt Crunchy PGO** for this homelab: its default install path
  couples you to Crunchy's own image distribution under the Crunchy Data
  Developer Program Terms, which adds a licensing dimension the other two
  options don't have; the underlying operator features don't clearly
  exceed CNPG for a single-operator homelab.
- **Zalando Postgres Operator is a reasonable second choice** if broader
  bundled extensions (pgvector, pg_cron, postgis, timescaledb, etc. via
  Spilo) turn out to matter more than CNPG's simpler Lease-based HA — but
  start with CNPG given the "cheap/simple first" constraint.
- **For Redis**, adopt the **Spotahome redis-operator** (Apache 2.0,
  Sentinel-based primary/replica failover, active maintenance, simplest
  feature surface) as the default for apps that need HA Redis; consider
  **OT-CONTAINER-KIT's redis-operator** instead only if a given app
  specifically needs Redis Cluster-mode sharding (Spotahome's operator is
  Sentinel/primary-replica only, not cluster mode). Both are direct,
  per-app-instance operators with no shared-instance model, matching the
  per-app-instance recommendation above. Do not pursue Redis Enterprise
  for Kubernetes here — it is a commercial product; its REC/REDB
  shared-instance model is the "right" architecture for pooling many
  tenants onto one Redis deployment, but licensing cost puts it outside
  this repo's free-tier-first constraint unless a specific future need
  justifies the spend.
