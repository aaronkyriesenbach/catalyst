# PROJECT KNOWLEDGE BASE

Kubernetes infrastructure-as-TypeScript repo. Defines cluster apps as typed configs (`AppConfig`) that ArgoCD renders into manifests via a Bun-based CMP plugin. Domain: `lab53.net`.

## STRUCTURE

```
catalyst/
├── main.ts              # CMP plugin entrypoint — two modes: single app (ARGOCD_ENV_APP = module name) or enumerate all
├── utils.ts             # Builders: Deployment, Service, HTTPRoute, GeneratedSecret + loadAppConfig
├── modifiers.ts         # WorkloadModifier pattern: withNasMounts, withPostgres, withOidcAuth, applyModifiers
├── storage.ts           # PV/PVC builders for NAS-backed NFS storage
├── versions.ts          # Typed image + Helm chart version registry (Renovate-parsed; see Image sources)
├── types.ts             # AppConfig = WorkloadApp | StaticApp; HelmRelease, ExternalApp, BackendTLSPolicy
├── apps/                # Each *.ts exports default AppConfig — auto-discovered by main.ts
│   ├── traefik/         # Submodule: gateways, routes, certs, external app proxy config
│   ├── cert-manager/    # Submodule: internal CA, issuers
│   └── <app>/           # Some apps have subdirectories for values YAML or config files
├── scripts/
│   ├── render.ts        # CLI: bun run render <app-name> → stdout YAML
│   ├── apply-cluster.ts # CLI: bun run apply-cluster <node> — rsync manifests to k3s server
│   └── sync-external-certs.ts
├── docs/                # Design docs (e.g., forward-auth.md)
├── cluster/             # Bootstrap manifests: ArgoCD values, kube-vip, traefik config
└── irsa.md              # IRSA setup docs (AWS OIDC, S3, IAM)
```

## COMMANDS

```bash
bun run render <app-name>                    # Render single app to stdout YAML (verify changes)
bun run apply-cluster <node> [--dry-run]     # Sync cluster/ manifests to k3s server via rsync+SSH
bun run sync-external-certs [--dry-run]      # Pull TLS certs from cluster via kubectl
bun run typecheck                            # tsc --noEmit
bun run check-versions                       # Verify versions.ts matches the Renovate-parsed format
bun run install-argo                         # helm upgrade --install ArgoCD with custom values
bunx prettier --write .                      # Format the repo (config: .prettierrc, .prettierignore)
```

**kubectl access**: The agent has `kubectl` configured and may query the cluster to verify live state — CIDR ranges, services, nodes, etc.

**Verification**: Always run `bun run render <app-name>` after editing an app file to confirm valid YAML output.

## CONVENTIONS

### App System

- **App discovery**: `main.ts` reads `apps/` with `readdirSync` filtering `entry.isFile()`. Only top-level `.ts` files are discovered — not subdirectories.
- **Default export required**: `loadAppConfig` reads `mod.default`. Named-only exports will silently produce no config.
- **Two app kinds**: `WorkloadApp` (auto-generates Deployment+Service+HTTPRoute from `podSpec`) and `StaticApp` (explicit `resources` array).
- **App namespace**: Defaults to `name` when `namespace` is omitted.
- **Security context**: `renderWorkload` auto-applies `runAsNonRoot: true, runAsUser/Group: 1000` if `podSpec.securityContext` is not set. Set it explicitly to override.

### Modifiers (WorkloadApp only)

- Compose via `applyModifiers(base, ...modifiers)` — each modifier is an immutable transform.
- `withNasMounts(config)` — adds NFS volume + mounts keyed by container name. Throws if container name doesn't exist.
- `withPostgres(version, options?)` — adds postgres as an **init container** with NAS-backed data at `cluster/<app>/postgres`. `version` is restricted to the majors in `postgresImages` (`versions.ts`); the image comes from there (mirrored `library/postgres:<major>-alpine`) unless `options.image` overrides it.
- `withOidcAuth(options?)` — creates PocketID OIDC client/group resources. With `{ middleware: true }`, also adds Traefik OIDC middleware + ESO-generated plugin secret and sets `forwardAuth: true`. See `docs/forward-auth.md`.

### Generated Secrets

- `buildGeneratedSecret(name, keys)` in `utils.ts` creates ExternalSecret + optional per-key Password generators.
- Depends on the `external-secrets` app being installed (`apps/external-secrets.ts`).
- Keys can be strings (use cluster-wide default generator) or objects with `{ key, length?, encoding? }`.

### Routing

- Internal: `<name>.int.lab53.net` → gateway `traefik-internal`
- External: `<name>.lab53.net` → gateways `traefik-external` + `traefik-internal`
- Controlled by `externallyAccessible` flag. Override hostname with `subDomain`.
- `forwardAuth: true` adds an `ExtensionRef` filter pointing to the `oidc-auth` Middleware.

### Helm Charts

- Declare charts with `helmReleases: [{ chart, releaseName, values?, parameters?, skipCrds? }]` on the app. `buildApplication` turns each release into a native ArgoCD Helm source (multi-source Application), so chart resources are tracked by Argo with diffs in its UI. Helm is **not** in the CMP sidecar, and the k3s `HelmChart` CRD is not used for apps (only k3s's bundled `traefik`/`traefik-crd`).
- Chart repo/name/version live in `helmCharts` in `versions.ts` (`chart` is a `HelmChartKey`). Never write repo URLs or versions in `apps/*.ts`.
- `releaseName` must equal the live Helm release name when adopting an existing install. Charts install into the app's destination namespace (`namespace ?? name`); adopted releases are pinned in `helmReleaseNamespaces` (`constants.ts`) so a namespace change fails the render.
- Load values from a file with `await readYaml("./app/values.yaml", import.meta.url)`; `--set` equivalents go in `parameters`.
- When several releases of one chart share a namespace, set `skipCrds: true` on all but one so a `crds/` directory is not rendered twice.
- Use `ignoreDifferences` (typed from `@kubernetes-models/argo-cd`) for fields written at runtime by controllers. Apps with `helmReleases` get `ServerSideApply=true` and `ServerSideDiff=true`; automated sync stays off.
- `bun run render <app>` only shows CMP-rendered resources. Chart output is visible in ArgoCD (`argocd app manifests <app>`) or via `bun run render-chart <app>` (needs the `helm` CLI; an approximation of Argo's output).
- Migrating a live `HelmChart` to `helmReleases` must not uninstall the release. Detach it first: annotate the `HelmChart` with `helmcharts.helm.cattle.io/unmanaged=true`, clear its finalizers, then delete it, and verify resource UIDs are unchanged. Deleting a `HelmChart` that still has the `wrangler.cattle.io/on-helm-chart-remove` finalizer runs `helm uninstall`.

### Scripts and embedded files

- Never inline shell scripts in `apps/*.ts`. Put them in a file next to the app (e.g. `apps/<app>/<name>.sh`), load with `readFile(...)` into `buildFileConfigMap(...)`, mount the ConfigMap, and run it with `command: ["/bin/sh", "/scripts/<name>.sh"]`. Pass values the script needs as container `env`, not TS string interpolation, so the file stays a plain, lintable script.
- Indent anything embedded in a ConfigMap with **spaces, not tabs** (`.editorconfig` enforces this for `*.sh`). A tab makes Go/JS YAML encoders (kubectl, ArgoCD UI) render the whole value as one quoted `\n`-escaped string.

### External Apps (traefik module)

- Defined in `apps/traefik/externalApps.config.ts` — proxied non-cluster services (UniFi, TrueNAS, Proxmox).
- Auto-generates EndpointSlice, Service, Certificate, BackendTLSPolicy, and HTTPRoute per entry.

### Runtime & TypeScript

- **Bun only**. Scripts use `Bun.spawn`, `Bun.file`, `Bun.write`. Bun-compatible `node:` imports are fine.
- Strict mode, `noUncheckedIndexedAccess`, ES2022 target, ESM, `moduleResolution: bundler`.
- Relative imports only (no path aliases). Standard for flat repo.
- No linter, tests, or CI. ArgoCD CMP plugin renders in-cluster.
- **Formatting**: Prettier is a devDependency, configured via `.prettierrc` (explicit defaults) and `.prettierignore` (`node_modules/`, `downloads/`, `bun.lock`, `.sisyphus/`, `.omo/`). Run `bunx prettier --write .` before committing.
- **Prefer imported types over hand-rolled ones.** Before defining a new type, check whether `kubernetes-models`, `@kubernetes-models/gateway-api`, `@kubernetes-models/traefik`, or other installed packages already export a matching interface (e.g. `IPersistentVolumeClaimTemplate`, `IPodSpec`, `IServicePort`). Hand-roll types only when no package provides them (e.g. `BackendTLSPolicy` for the GA `gateway.networking.k8s.io/v1` API that the package hasn't caught up to yet).

### Infrastructure

- NAS: IP `192.168.53.120`, base path `/mnt/tank/data`. Hardcoded in `modifiers.ts` and `storage.ts`.
- Private registry mirror: `docker.int.lab53.net`.

### Image sources

- Every container image and Helm chart version is declared in `versions.ts` (`images`, `postgresImages`, `helmCharts`) and consumed via `image(key)`, `postgresImage(major)` and `HelmRelease.chart` keys. Do not write image strings in `apps/*.ts`.
- **Docker Hub images** (`docker.io/...`) are `mirrored: true` — rendered via `docker.int.lab53.net/<path>:<tag>` — except `registry`, which is the mirror itself and stays `mirrored: false`.
- **All other registries** (ghcr.io, docker.dragonflydb.io) → no `mirrored` field; rendered with their actual source URL. Adding a registry means extending `NonHubRegistry` in `versions.ts`.
- `versions.ts` is parsed by Renovate regexes: keep the exact field order and one-entry-per-object shape, then run `bun run check-versions` and `bun run typecheck`.
- Exceptions: digest-pinned images (`apps/iso-archive.ts`) and images inside YAML files (`cluster/*.yaml`, `apps/*/values.yaml`).
- ArgoCD CMP sidecar: `oven/bun` image, plugin name "ts", discovery key `main.ts`.
- `cluster/` manifests are applied directly to k3s server manifest dir — outside ArgoCD management.

## ANTI-PATTERNS

- **No `index.ts` in `apps/`** — `main.ts` filters `entry.isFile()`, directories with index exports won't be discovered.
- **No named-only exports** — `loadAppConfig` reads `mod.default`. Apps that only export named values produce nothing.
- **No `HelmChart` CRD resources for apps** — use `helmReleases`; the helm-controller would own (and on delete, uninstall) the release.
- **Don't add apps to a registry** — discovery is automatic from the `apps/` directory.

## CROSS-MODULE EXPORTS

Some app files export named constants used by scripts and other modules:

- `apps/traefik.ts` → `traefikNamespace`
- `apps/cert-manager.ts` → `certManagerNamespace`
- `apps/cert-manager/internal-ca.ts` → `internalRootCaSecretName`
- `apps/traefik/externalApps.config.ts` → `externalApps`, helper functions

## Agent skills

### Issue tracker

GitHub Issues on `aaronkyriesenbach/catalyst`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
