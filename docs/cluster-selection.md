# Cluster selection and the `cluster` singleton

Status: open problem, no design agreed. This document records the facts only.

## Background

The repo supports more than one cluster directory under `clusters/`, but only `cluster0` is a catalyst cluster (apps rendered by the ArgoCD CMP plugin in `main.ts`). `clusters/omni` is Pulumi-only: no `apps/`, no `cluster.ts`, no Argo. Future clusters will get their Argo installed by Omni, not from a `clusters/<name>/bootstrap/argocd-values.yaml` file in this repo.

## The two mechanisms in question

**1. Choosing the target cluster.** `currentCluster()` in `packages/core/clusters.ts` reads `ARGOCD_ENV_CLUSTER`. If it is unset and exactly one cluster directory exists, it uses that one; with more than one it throws. `tools/app-names.ts` repeats the same scan on purpose, because CI runs it from the base checkout and it must not import app code.

**2. Reading the target cluster.** `packages/core/cluster.ts` is `export const cluster = await loadCluster(currentCluster())`, a module-level singleton imported across the codebase:

- Directly: `clusters/cluster0/apps/{kube-vip,cloudflared}.ts`, `apps/arr/common.ts`, `apps/traefik/gateway.ts`, `packages/k8s/secrets.ts`, `packages/platform/waf.ts`, `main.ts`, `tools/render.ts`, `tools/chart-images.ts`.
- Fields read: `name`, `network.{podCidr,serviceCidr,vips}`, `edge.cloudflareTunnelId`, `gitops.*`.
- Transitively: `secrets.ts` and `waf.ts` compute module-level constants from it at import time (`PUSH_SECRET_PREFIX`, `TRUSTED_PROXY_CIDRS`). Their consumers are `awsRemoteKey` (14 files), `buildGeneratedSecret` (12 files) and the WAF helpers (5 files).

## Facts

- Nothing sets `ARGOCD_ENV_CLUSTER` anywhere in the repo. `buildApplication` (`packages/argocd/application.ts`) passes only `APP` as plugin env, the root Application `clusters/cluster0/bootstrap/catalyst-app.yaml` has no plugin env, and the CMP sidecar env in `argocd-values.yaml` has only `BUN_INSTALL_CACHE_DIR`. Production rendering therefore depends on there being exactly one directory under `clusters/`. The live sidecar environment was not inspected (no cluster access from the working session).
- Adding `clusters/omni` made `bun run validate` and `bun run render` fail, and `validate` still failed with `ARGOCD_ENV_CLUSTER=cluster0` set; the second failure's cause was not read, only observed to disappear after the stopgap below.
- `buildCatalog` in `packages/core/apps.ts` imports the apps of every cluster in one process, while the singleton is bound to the current cluster only. Any app module that reads `cluster` at import time therefore sees the current cluster's values even when it belongs to another cluster. With one catalyst cluster this cannot be observed; it follows from reading the code and was not reproduced.
- `DeriveContext` (`{ catalog, cluster }`) already passes a cluster explicitly to `derive` hooks, so the singleton and an explicit value coexist today.

## Stopgap already in the working tree (uncommitted)

`listClusters()` in `packages/core/clusters.ts` and the scan in `tools/app-names.ts` now count only directories that contain `apps/`. This keeps `clusters/omni` from being treated as a catalyst cluster. It does not change how the target cluster is chosen or read. With it, `bun run validate` passes (41 apps) and `render-all` output for cluster0 is byte-identical to `HEAD`.

## Constraints to respect

- Argo for future clusters is installed by Omni, so cluster identity cannot rely on a per-cluster file in this repo's Argo bootstrap values.
- `render-all` and `render-charts` run from the base checkout using head's `tools/` and must not import app code (see Renovate and verify notes in `AGENTS.md`).
- Repo preference: strong typing over custom validation.
- A change that should not alter manifests must leave `bun run render-all` output identical; a change that alters Application resources will not.
- The CMP sidecar has no `node_modules`; it relies on Bun resolving `@catalyst/*` from the root `tsconfig.json`.

## Open questions for research

- What exactly the CMP sidecar receives for an Application: the whole repository or only the source path. This determines what an entrypoint outside the repo root could import.
- Which app files truly depend on the cluster, directly or through builders, as opposed to the counts above, which overlap.
- Whether any other process-wide state besides `cluster` (module-level constants derived from it, `loadCatalog`'s cached promise) has the same wrong-cluster hazard once a second catalyst cluster exists.
- How Omni's Argo installation will deliver the CMP plugin config and the root Application for a new cluster, and what per-cluster inputs it can supply.
