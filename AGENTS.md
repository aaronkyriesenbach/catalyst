# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-16
**Commit:** fabef4f
**Branch:** master

## OVERVIEW

Kubernetes infrastructure-as-TypeScript repo. Defines cluster apps as typed configs (`AppConfig`) that ArgoCD renders into manifests via a Bun-based CMP plugin. Domain: `lab53.net`.

## STRUCTURE

```
catalyst/
├── main.ts              # CMP plugin entrypoint — renders all apps or single app via ARGOCD_ENV_APP_CONFIG
├── utils.ts             # Builders: Deployment, Service, HTTPRoute + loadAppConfig (dynamic import)
├── modifiers.ts         # WorkloadModifier pattern: withNasMounts, withSecurityDefaults, applyModifiers
├── storage.ts           # PV/PVC builders for NAS-backed NFS storage
├── types.ts             # AppConfig = WorkloadApp | StaticApp; HelmChart, ExternalApp, BackendTLSPolicy
├── apps/                # Each *.ts exports default AppConfig — auto-discovered by main.ts
│   ├── traefik/         # Submodule: gateways, routes, certs, external app proxy config
│   ├── cert-manager/    # Submodule: internal CA, issuers
│   ├── external-dns/    # Helm values YAML files
│   └── immich/          # Helm values YAML
├── scripts/
│   ├── render.ts        # CLI: bun run render <app-name> → stdout YAML
│   └── sync-external-certs.ts  # Fetches TLS secrets from cluster via kubectl
├── cluster/             # Bootstrap manifests: ArgoCD values, kube-vip, traefik config
└── irsa.md              # IRSA setup docs (AWS OIDC, S3, IAM)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add a new workload app | `apps/<name>.ts` | Export default `WorkloadApp` with podSpec + webPort |
| Add a new static/helm app | `apps/<name>.ts` | Export default `StaticApp` with resources array |
| Add NAS mounts to an app | `modifiers.ts` | Use `withNasMounts()` + `applyModifiers()` |
| Add NFS-backed PV/PVC | `storage.ts` | `buildNasPersistentVolumePair()` |
| Modify routing/gateways | `apps/traefik/` | `gateway.ts`, `routes.ts`, `externalApps.config.ts` |
| Change TLS/cert config | `apps/cert-manager/` | `internal-ca.ts`, `issuers.ts` |
| Render a single app locally | CLI | `bun run render <app-name>` |
| Install/update ArgoCD | CLI | `bun run install-argo` |
| Sync external certs | CLI | `bun run sync-external-certs [--dry-run]` |
| Cluster bootstrap docs | `cluster/README.md` | k3s setup, ArgoCD install, kube-vip |

## CONVENTIONS

- **Runtime**: Bun only. Scripts use `Bun.spawn`, `Bun.file`, `Bun.write`. Node will not work for scripts.
- **App discovery**: `main.ts` reads `apps/` directory at runtime. Adding/removing a `.ts` file adds/removes an app. No registry or index file.
- **Two app kinds**: `WorkloadApp` (podSpec-based, auto-generates Deployment+Service+HTTPRoute) and `StaticApp` (explicit resources array).
- **Modifier pattern**: Compose `WorkloadModifier` functions via `applyModifiers(app, ...modifiers)` — immutable transforms on `WorkloadApp`.
- **HelmChart type**: Not from kubernetes-models; hand-typed in `types.ts` for `helm.cattle.io/v1` CRDs.
- **Routing**: Internal apps get `<name>.int.lab53.net`, external get `<name>.lab53.net`. Controlled by `externallyAccessible` flag.
- **Gateway refs**: Internal → `traefik-internal`, External → both `traefik-external` + `traefik-internal`.
- **NAS defaults**: IP `192.168.53.120`, path `/mnt/tank/data`. Hardcoded in `modifiers.ts` and `storage.ts`.
- **No linter/formatter**: No ESLint, Prettier, or EditorConfig configured.
- **No tests**: No test framework, no test files.
- **No CI**: No GitHub Actions or CI workflows. ArgoCD CMP plugin renders in-cluster.
- **TypeScript**: Strict mode, `noUncheckedIndexedAccess`, ES2022 target, ESM modules, `moduleResolution: bundler`.
- **Imports**: Relative imports (no path aliases). Standard for small flat repos.

## ANTI-PATTERNS (THIS PROJECT)

- Do not add `index.ts` files in `apps/` — main.ts filters for files only, not directories with index exports.
- Do not use Node-specific APIs in scripts — Bun APIs are used (`Bun.spawn`, `Bun.write`).
- Do not create apps that export named exports instead of `default` — `loadAppConfig` reads `mod.default`.
- HelmChart type is manually defined — do not look for it in kubernetes-models packages.

## COMMANDS

```bash
bun run render <app-name>              # Render single app to stdout YAML
bun run sync-external-certs            # Pull TLS certs from cluster
bun run sync-external-certs --dry-run  # Preview cert sync
bun run install-argo                   # Install/upgrade ArgoCD with custom values
```

## NOTES

- ArgoCD CMP sidecar runs `oven/bun:1.3.11` image in repo-server pod. CMP plugin name is "ts", discovery key is `main.ts`.
- `main.ts` has two modes: with `ARGOCD_ENV_APP_CONFIG` (single app render for CMP) and without (enumerate all apps, emit Application CRDs).
- Apps reference upstream container images — this repo does not build/push any images.
- `irsa.md` contains extensive AWS IRSA setup docs with manual operator commands. Not automated.
- `cluster/` contains bootstrap manifests applied directly to k3s server manifest dir — outside ArgoCD management.
