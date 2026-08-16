# Dedicated, HA platform cluster for shared platform services

Status: accepted

Shared platform services (observability, secrets-sync, service mesh control plane,
database-as-a-service operator, registry, identity infrastructure, etc.) run on their own dedicated
**Platform cluster**, separate from whatever **Workload cluster(s)** the `catalyst` app-config layer
targets — rather than sharing a cluster with workload apps. The platform cluster's control-plane
targets Talos/Omni's standard 3-node HA (per ADR-adjacent decision in
[#7](https://github.com/aaronkyriesenbach/catalyst/issues/7)), accepted only once a third physical node
exists; its nodes remain schedulable/combined (no separate CP-only nodes) rather than tainting the
control plane off-limits to workloads. Platform-only status is enforced with a Kubernetes taint (and a
matching toleration on every platform Deployment/HelmRelease), not left as an unenforced convention.

The isolation this buys is the point: a botched workload-cluster deploy or upgrade can't take down the
observability stack you'd use to diagnose it, and everything platform-shaped lives in exactly one place
rather than being split between "in-cluster" and "just a container next to Omni" on a case-by-case
basis — including the registry pull-through cache, which becomes a k8s-native workload here rather than
staying a bare container.

## Considered Options

- **Shared workload/platform cluster** — rejected: no isolation between platform services and workload
  churn, and undercuts the migration strategy's ([#31](https://github.com/aaronkyriesenbach/catalyst/issues/31))
  assumption that multiple clusters already coexist during cutover.
- **CP-only (tainted) platform-cluster nodes with separate dedicated workers** — rejected as unnecessary
  overhead at homelab scale; the isolation value sought here is cluster-boundary isolation, not
  CP/worker role separation.
- **Convention-only platform/workload boundary** (no taint) — rejected as likely to erode the first time
  it's convenient to drop one more thing on whichever cluster is easiest.

## Consequences

- Every future shared-platform-service decision (registry, DB operator, observability, mesh, etc.)
  targets this cluster by default; a case for running something elsewhere now needs an explicit
  justification rather than being the default.
- The platform cluster isn't built until a third physical node exists to support its HA target — this
  decision doesn't unblock implementation on today's 2-node hardware.
- `CONTEXT.md` gains **Platform cluster** and **Workload cluster** as contrasted terms, alongside
  **Management host** (Omni's standalone VM, deliberately neither).
