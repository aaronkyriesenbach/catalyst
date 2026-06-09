# PROJECT KNOWLEDGE BASE

Kubernetes infrastructure-as-TypeScript repo. Defines cluster apps as typed configs (`AppConfig`) that ArgoCD renders into manifests via a Bun-based CMP plugin. Domain: `lab53.net`.

## STRUCTURE

```
catalyst/
├── main.ts              # CMP plugin entrypoint — two modes: single app (ARGOCD_ENV_APP_CONFIG) or enumerate all
├── utils.ts             # Builders: Deployment, Service, HTTPRoute, GeneratedSecret + loadAppConfig
├── modifiers.ts         # WorkloadModifier pattern: withNasMounts, withPostgres, withOidcAuth, applyModifiers
├── storage.ts           # PV/PVC builders for NAS-backed NFS storage
├── types.ts             # AppConfig = WorkloadApp | StaticApp; HelmChart, ExternalApp, BackendTLSPolicy
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
bun run install-argo                         # helm upgrade --install ArgoCD with custom values
```

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
- `withPostgres(version, options?)` — adds postgres as an **init container** with NAS-backed data at `cluster/<app>/postgres`. Uses `docker.int.lab53.net/library/postgres` by default.
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
- `HelmChart` type is hand-defined in `types.ts` for `helm.cattle.io/v1` CRDs — not from kubernetes-models.
- Embed values with `Bun.file(new URL("./app/values.yaml", import.meta.url)).text()` — this is a top-level await pattern used in several apps.

### External Apps (traefik module)
- Defined in `apps/traefik/externalApps.config.ts` — proxied non-cluster services (UniFi, TrueNAS, Proxmox).
- Auto-generates EndpointSlice, Service, Certificate, BackendTLSPolicy, and HTTPRoute per entry.

### Runtime & TypeScript
- **Bun only**. Scripts use `Bun.spawn`, `Bun.file`, `Bun.write`. Bun-compatible `node:` imports are fine.
- Strict mode, `noUncheckedIndexedAccess`, ES2022 target, ESM, `moduleResolution: bundler`.
- Relative imports only (no path aliases). Standard for flat repo.
- No linter, formatter, tests, or CI. ArgoCD CMP plugin renders in-cluster.
- **Prefer imported types over hand-rolled ones.** Before defining a new type, check whether `kubernetes-models`, `@kubernetes-models/gateway-api`, `@kubernetes-models/traefik`, or other installed packages already export a matching interface (e.g. `IPersistentVolumeClaimTemplate`, `IPodSpec`, `IServicePort`). Hand-roll types only when no package provides them (e.g. `HelmChart` for `helm.cattle.io/v1`, `BackendTLSPolicy` for the GA `gateway.networking.k8s.io/v1` API that the package hasn't caught up to yet).

### ArgoCD CMP env-substitution (footgun)
The CMP runs env-var substitution over rendered manifests: any `$VAR`/`${VAR}` is replaced with empty string — **silently, no error**. When embedding content with literal `$` (shell scripts, configs, JS template literals):
- **Files into a ConfigMap** → `buildFileConfigMap(name, files)` in `utils.ts` (base64 `binaryData`; robust for arbitrary content).
- **Inline string fields** (container `args`/`env.value`, HelmChart `valuesContent`) → wrap with `escapeArgoCmp(content)` in `utils.ts` (escapes `$` → `$$`); `binaryData` isn't available there.

### Infrastructure
- NAS: IP `192.168.53.120`, base path `/mnt/tank/data`. Hardcoded in `modifiers.ts` and `storage.ts`.
- Private registry mirror: `docker.int.lab53.net`.
- ArgoCD CMP sidecar: `oven/bun` image, plugin name "ts", discovery key `main.ts`.
- `cluster/` manifests are applied directly to k3s server manifest dir — outside ArgoCD management.

## ANTI-PATTERNS

- **No `index.ts` in `apps/`** — `main.ts` filters `entry.isFile()`, directories with index exports won't be discovered.
- **No named-only exports** — `loadAppConfig` reads `mod.default`. Apps that only export named values produce nothing.
- **No HelmChart from packages** — it's hand-typed in `types.ts`.
- **Don't add apps to a registry** — discovery is automatic from the `apps/` directory.
- **No raw `$`-bearing embeds** — ConfigMap `data` / inline strings with literal `$` get silently emptied by CMP substitution. Use `buildFileConfigMap()` (base64 binaryData) or `escapeArgoCmp()`.

## CROSS-MODULE EXPORTS

Some app files export named constants used by scripts and other modules:
- `apps/traefik.ts` → `traefikNamespace`
- `apps/cert-manager.ts` → `certManagerNamespace`
- `apps/cert-manager/internal-ca.ts` → `internalRootCaSecretName`
- `apps/traefik/externalApps.config.ts` → `externalApps`, helper functions
