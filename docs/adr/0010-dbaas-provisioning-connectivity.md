# DBaaS provisioning and connectivity mechanics

Status: accepted

Settles the mechanics [ADR 0006](0006-dbaas-cloudnativepg.md) deliberately left open: how an app's
CloudNativePG `Cluster` CR (platform cluster) gets provisioned separately from the rest of the app
(workload cluster), how the workload-cluster app reaches it over the network, how that connection is
secured, and how the two existing `withPostgres` consumers (`miniflux`, `shakedown`) migrate.

## Decision

- **Provisioning**: `withPostgres`'s replacement modifier emits a **second, sibling `Application`** (e.g.
  `<app>-postgres`) alongside the app's own, always destined for the platform cluster — not folded into
  the app's own `extraResources`, since one ArgoCD `Application` can only target one destination cluster
  (`buildApplication()`'s `destination.server`). The concrete syntax for pinning that destination reuses
  whatever [#42](https://github.com/aaronkyriesenbach/catalyst/issues/42) settles for expressing a cluster
  target on an `AppConfig` — the same deferral [ADR 0009](0009-ingress-istio-no-mesh-span.md) already made
  for Istio's own multi-cluster rollout. This is a **fixed** pin (always platform), distinct from the
  `ApplicationSet` Cluster-generator use case (stamping the _same_ manifest across every registered
  cluster, e.g. Istio, the OTel collector in #44) — #42's answer just needs to also support "always this
  one specific cluster," not only "every registered cluster."
- **Connectivity**: each app's CNPG `Cluster` gets a **CNPG-native `LoadBalancer` service**
  (`managed.services.additional`, `selectorType: rw`) — CNPG's own documented pattern for exactly this
  "app and database in different Kubernetes clusters" topology, used by its own adopters (GKE, AKS, IBM
  Cloud Pak, Tembo). Rejected the alternative of a Gateway API `TCPRoute` on the platform cluster's
  internal Istio Gateway: Postgres's wire protocol has no SNI/host-based multiplexing, so a `TCPRoute`
  approach would need one dedicated `Listener`/port per app on a shared Gateway IP — no simpler than one
  dedicated LoadBalancer IP per app, and it pulls the ingress layer into a role it wasn't designed for.
  Cost: one LoadBalancer IP per app's database, drawn from whatever [#46](https://github.com/aaronkyriesenbach/catalyst/issues/46)/[#47](https://github.com/aaronkyriesenbach/catalyst/issues/47)
  land on for LB implementation, in addition to the one IP per cluster's Istio Gateway.
- **Connection security**: `sslmode=verify-full`, not `sslmode=require`. `require` encrypts but performs
  no certificate validation at all — it protects against passive eavesdropping but not an active
  man-in-the-middle, who can present any self-signed certificate and have `require` accept it. `verify-full`
  additionally validates the server certificate against a trusted CA and checks the hostname/SAN match,
  closing that gap — the right bar now that this traffic crosses a real network/VLAN boundary rather than
  staying inside one cluster's pod network. The CNPG-generated CA hand-off to the workload cluster rides on
  whatever the new secrets-propagation ticket (split off from this one, see below) decides for moving
  OpenBao-backed material across clusters generally.
- **Backup**: CNPG-native **Barman Cloud plugin** PITR (continuous WAL archiving + point-in-time recovery
  to object storage), replacing `withPostgres`'s bolted-on `buildBackupResources` (VolSync/restic
  snapshotting) for the Postgres case specifically. `buildBackupResources` remains in use for non-Postgres,
  NAS-backed app data (e.g. `withNasMounts` consumers).
- **Migration of `miniflux`/`shakedown`**: **decoupled** into two separate moves — migrate each app's
  database to CNPG first (app still runs on today's single cluster), then move the app's own compute to
  its target workload cluster later, once that cluster exists. De-risks each move independently and proves
  the cross-cluster DB connectivity path before the app itself is also in motion.

## Considered Options

- **Fold the `Cluster` CR into the app's own `extraResources`** — rejected: technically impossible under
  ArgoCD's one-`Application`-one-destination model without also changing the app's own destination, which
  would defeat the point of a workload cluster.
- **Gateway API `TCPRoute` per app on the shared platform-cluster internal Gateway** — rejected: no
  simpler than a dedicated LB per app (still one port/identity per app, just moved from IP-space to
  port-space) and misuses the ingress layer for raw TCP database traffic it wasn't chosen for.
- **`sslmode=require`** — rejected: leaves an active man-in-the-middle on the LAN/VLAN path fully
  undetected; the CA is already available to distribute, so there's no real cost to closing the gap.
- **Keep VolSync/restic for Postgres** — rejected: CNPG's own Barman Cloud plugin is purpose-built for
  Postgres PITR (continuous WAL archiving, not just periodic snapshots), and this is the natural point to
  stop carrying two backup mechanisms for the same data type.
- **Bundle DB migration with each app's move to its workload cluster** — rejected: couples two
  independent risks (data migration correctness, cross-cluster network path) into one cutover instead of
  proving them separately.

## Consequences

- `types.ts`/`main.ts` need a new concept: a modifier contributing an **additional, separately-destined
  `Application`**, not just extra resources on the existing one. This is new ground for the `AppConfig`/
  `WorkloadModifier` model.
- A new ticket — general "how do OpenBao-backed secrets reach ESO on a workload cluster" — is split off
  from this one; it's every app's problem, not DBaaS-specific, and this ADR's `verify-full`/CA hand-off
  depends on its answer without re-deciding it here.
- `modifiers.ts`'s `withPostgres` is replaced entirely; its `buildBackupResources` call sites for Postgres
  data go away, but the function itself stays in use for NAS-backed app data.
- `miniflux` and `shakedown`'s `DATABASE_URL` env vars (currently `postgres://<app>:<app>@<app>-postgres:5432/...?sslmode=disable`)
  move to the CNPG-issued LoadBalancer hostname/IP and `sslmode=verify-full`, with credentials sourced from
  CNPG's generated `<cluster>-app` Secret instead of hardcoded values.
