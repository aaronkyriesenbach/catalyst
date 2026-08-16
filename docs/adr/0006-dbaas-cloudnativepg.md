# Database-as-a-service: CloudNativePG, centralized on the platform cluster

Status: accepted

Adopt **CloudNativePG (CNPG)** as the platform's Postgres operator, replacing the hand-rolled
`withPostgres` StatefulSet modifier (`modifiers.ts`). Chosen over Zalando Postgres Operator and Crunchy
PGO per [research #24](https://github.com/aaronkyriesenbach/catalyst/issues/24): Apache-2.0 with no
commercial-image licensing entanglement (unlike Crunchy PGO's default Developer Program images), and the
simplest HA model of the three (Kubernetes `Lease`-based failover, no separate Patroni/DCS layer).
Postgres instances stay **per-app** (one `Cluster` CR per app) rather than shared-instance — matches how
all three operators surveyed expect to be used, and matches this repo's existing per-app
`WorkloadModifier` mental model.

**Centralized on the platform cluster, not duplicated per workload cluster.** Per ADR 0002, the platform
cluster already hosts every shared platform service including "the database-as-a-service operator" — this
ADR confirms that's read literally: the CNPG operator and every app's `Cluster` CR (the actual Postgres
pod + PVC) live only on the platform cluster, as one fleet, regardless of which workload cluster the
consuming app runs on. Workload-cluster apps always reach their database over the network rather than
getting a co-located, per-cluster CNPG install — closer to a real DBaaS model (cf. RDS/Cloud SQL) and
avoiding N independent operator installs each needing their own day-2 attention.

**The provisioning and connectivity mechanics are deliberately not decided here** — routing a `Cluster`
CR's manifest to the platform cluster while its consuming app deploys to a workload cluster depends on the
still-open GitOps/CD topology ([#38](https://github.com/aaronkyriesenbach/catalyst/issues/38)); the network
path from a workload-cluster pod to the platform cluster depends on the still-open mesh
([#21](https://github.com/aaronkyriesenbach/catalyst/issues/21)) and ingress-placement
([#36](https://github.com/aaronkyriesenbach/catalyst/issues/36)) decisions. See
[Decide DBaaS provisioning/connectivity mechanics across clusters](https://github.com/aaronkyriesenbach/catalyst/issues/40).

**Redis/Valkey is out of scope here.** Research #24's Redis-operator survey (Spotahome vs.
OT-CONTAINER-KIT) didn't consider Valkey or other Redis-compatible alternatives, and zero apps in this
repo currently use Redis. Deferred entirely until an app needs it, at which point the research should be
redone with Valkey in scope — not inherited from this ADR.

**Backup mechanism and migration of the two existing consumers (`miniflux`, `shakedown`) are also
deferred** — both ride on the provisioning/connectivity ticket above landing, plus the general
backup-approach question (VolSync/restic vs. CNPG-native Barman Cloud PITR) remaining open.
