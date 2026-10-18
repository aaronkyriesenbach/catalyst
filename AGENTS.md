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
├── types.ts             # AppConfig = WorkloadApp | StaticApp; HelmRelease, ExternalApp
├── apps/                # Each *.ts exports default AppConfig — auto-discovered by main.ts
│   ├── traefik/         # Submodule: gateways, routes, certs, external app proxy config
│   ├── cert-manager/    # Submodule: internal CA, issuers
│   └── <app>/           # Some apps have subdirectories for values YAML or config files
├── scripts/
│   ├── render.ts        # CLI: bun run render <app-name> → stdout YAML
│   └── sync-external-certs.ts
├── docs/                # Design docs (e.g., forward-auth.md)
├── cluster/             # Bootstrap files applied by hand: ArgoCD values, root app
└── irsa.md              # IRSA setup docs (AWS OIDC, S3, IAM)
```

## COMMANDS

```bash
bun run render <app-name>                    # Render single app to stdout YAML (verify changes)
bun run sync-external-certs [--dry-run]      # Pull TLS certs from cluster via kubectl
bun run typecheck                            # tsc --noEmit
bun run render-all <outdir>                  # Render every app + project + enumerate-all into <outdir> (what CI runs)
bun run render-charts <outdir>               # render-chart for every app with helmReleases (needs helm)
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

### Rollouts and probes

- `buildDeployment`/`buildStatefulSet` throw unless some container has a `readinessProbe`, because without one a pod is Ready at container start and the old pod is dropped immediately. Set `probeExempt: "<reason>"` (on `WorkloadApp` or the builder options) only when nothing can be probed.
- Build probes with `probes.ts` (`readiness`, `startup`, `httpCheck`/`tcpCheck`/`execCheck`) instead of hand-writing them. Prefer the app's real health endpoint; use `tcpCheck` on the web port when `/` needs auth or returns non-2xx/3xx. Add `startup(..., budgetSeconds)` for slow boots rather than `initialDelaySeconds`.
- Deployments default to `RollingUpdate` (`maxSurge: 1`, `maxUnavailable: 0`), `minReadySeconds: 15` and `progressDeadlineSeconds: 300`. Raise `progressDeadlineSeconds` on the app when startup plus image pulls can exceed that.
- `withIscsiVolumes` forces `Recreate` (RWO volume); those apps have a short outage on every rollout. NFS-only apps may overlap.
- external-dns stays `Recreate`: upstream says it has no leader election and must not run duplicate instances.

### Generated Secrets

- `buildGeneratedSecret(name, keys)` in `utils.ts` creates ExternalSecret + optional per-key Password generators.
- Depends on the `external-secrets` app being installed (`apps/external-secrets.ts`).
- Keys can be strings (use cluster-wide default generator) or objects with `{ key, length?, encoding? }`.

### Notifications

Services send push and email by POSTing `{title, body, type, tag}` to `<appriseUrl>/notify/<app-name>` (`apps/apprise.ts`). Apprise has no authentication, so it has no HTTPRoute and is reachable only inside the cluster; the key is just the notifying app's name and must be listed in `appriseNotifiers`, which renders `/config/<app-name>.yml` from `apps/apprise/notifier.yml`. The `tag` picks the route: `info` → Pushover normal, `warn` → Pushover high, `critical` → Pushover high + SES email, `emergency` → Pushover emergency (repeats until acknowledged) + SES email; add `push` or `email` (space-separated) to narrow to one channel, and a tag no URL carries returns 424. Credentials come from AWS Secrets Manager through an ExternalSecret template (`lab53/cluster0/apprise/pushover-credentials` and `ses-credentials`, key names in `apps/apprise.ts`). Healthchecks (`apps/healthchecks.ts`) is the dead-man switch for the cert-deploy CronJobs: they ping `<healthchecksUrl>/ping/<ping-key>/<cronjob-name>` (key at `lab53/cluster0/traefik/healthchecks-ping-key`), and a failed or missed ping fires its webhook integration, which posts `emergency` to `/notify/healthchecks`. The checks (slug = CronJob name) and the webhook are configured in the Healthchecks UI, not in code.

### Routing

- Internal: `<name>.int.lab53.net` → gateway `traefik-internal`
- External: `<name>.lab53.net` → gateways `traefik-external` + `traefik-internal`
- Controlled by `externallyAccessible` flag. Override hostname with `subDomain`.
- `forwardAuth: true` adds an `ExtensionRef` filter pointing to the `oidc-auth` Middleware.
- Every externally accessible route is behind the WAF unless exempted with a reason (see Web application firewall). `buildRoute` throws for an external route without `waf`.

### Web application firewall

`externallyAccessible: true` apps are inspected by CrowdSec AppSec through the community Traefik bouncer plugin; see `docs/waf.md`. `renderWorkload` adds a `crowdsec-appsec` Middleware and a WAF `ExtensionRef` filter (before `oidc-auth`) automatically. Change it per app with `withWaf({ profile?, bodyLimit? })` (profiles `default` and `strict`, defined in `waf.ts`) or opt out with `withoutWaf("<reason>")`; the reason is mandatory. `StaticApp`s that call `buildRoute` directly must pass `waf` (Immich is exempt for large uploads). Profiles each need their own AppSec port, so `apps/crowdsec.ts` generates listeners and Services from the table in `waf.ts`. The plugin fails open on AppSec/LAPI errors and trusts pod/service/LAN CIDRs. The bouncer key lives in AWS (`lab53/cluster0/crowdsec/crowdsec-keys`) and is copied into the `traefik` namespace for Traefik to mount (its pods wait in `ContainerCreating` until `crowdsec` has created that secret). The plugin version is pinned in `apps/traefik/values.yaml`, which Renovate does not track.

### Public access (Cloudflare Tunnel)

No inbound ports are open. `apps/cloudflared.ts` runs a locally-managed tunnel (`cloudflareTunnelId` in `constants.ts`) whose `config.yml` forwards `*.lab53.net` to Traefik over HTTPS and answers 404 for `*.int.lab53.net`. Public DNS exists only for hostnames external-dns publishes, so internal names are never routable through it.

- **DNS**: `lab53.net` is hosted at Cloudflare (registration stays at Route 53). `external-dns-ext` uses the Cloudflare provider with `--cloudflare-proxied`; the `external-dns.kubernetes.io/target` annotation on the `traefik-external` Gateway points every record at `<tunnel-id>.cfargotunnel.com`. Annotations must use the `external-dns.kubernetes.io/` prefix: external-dns ignores the old `alpha` prefix since v0.22, which silently turns records into A records for the Gateway's private IP.
- **Certificates**: the cert-manager issuers solve DNS-01 through Cloudflare.
- **Secrets** (AWS Secrets Manager): `lab53/cluster0/cloudflared/tunnel-credentials` (raw `cloudflared tunnel create` JSON), `lab53/cluster0/external-dns/cloudflare-api-token` and `lab53/cluster0/cert-manager/cloudflare-api-token` (JSON property `api-token`, zone-scoped DNS edit tokens).
- **Limits**: Cloudflare caps proxied request bodies at 100 MB on the Free plan, so large uploads (e.g. Immich videos) must go through the internal hostname on the LAN. Streaming large media through the proxy is restricted by Cloudflare's terms.
- **Traefik** is the official `traefik/traefik` chart in the `traefik` namespace, declared in `apps/traefik.ts` with values in `apps/traefik/values.yaml`; k3s's bundled Traefik is turned off with `disable: traefik` in `/etc/rancher/k3s/config.yaml`. The values raise the `https` read/idle timeouts for long uploads and trust pod IPs for forwarded headers. It runs 2 replicas with soft pod anti-affinity and a PodDisruptionBudget (`minAvailable: 1`), and the Service takes the kube-vip VIP `192.168.53.201`. The chart ships the Gateway API and Traefik CRDs, so deleting the Application would delete every Gateway, HTTPRoute and Middleware: use `argocd app delete --cascade=false`. Its image is not mirrored through `zot.int.lab53.net`, because that registry is served through Traefik and a restarted pod could not pull its own image.

### Helm Charts

- Declare charts with `helmReleases: [{ chart, releaseName, values?, parameters?, skipCrds? }]` on the app. `buildApplication` turns each release into a native ArgoCD Helm source (multi-source Application), so chart resources are tracked by Argo with diffs in its UI. Helm is **not** in the CMP sidecar, and the k3s `HelmChart` CRD is not used for apps.
- Chart repo/name/version live in `helmCharts` in `versions.ts` (`chart` is a `HelmChartKey`). Never write repo URLs or versions in `apps/*.ts`.
- `releaseName` must equal the live Helm release name when adopting an existing install. Charts install into the app's destination namespace (`namespace ?? name`); adopted releases are pinned in `helmReleaseNamespaces` (`constants.ts`) so a namespace change fails the render.
- Load values from a file with `await readYaml("./app/values.yaml", import.meta.url)`; `--set` equivalents go in `parameters`.
- When several releases of one chart share a namespace, set `skipCrds: true` on all but one so a `crds/` directory is not rendered twice.
- Use `ignoreDifferences` (typed from `@kubernetes-models/argo-cd`) for fields written at runtime by controllers. Apps with `helmReleases` also get `ServerSideApply=true` and `ServerSideDiff=true`.
- `bun run render <app>` only shows CMP-rendered resources. Chart output is visible in ArgoCD (`argocd app manifests <app>`) or via `bun run render-chart <app>` (needs the `helm` CLI; an approximation of Argo's output).

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
- **Prefer imported types over hand-rolled ones.** Before defining a new type, check whether `kubernetes-models`, `@kubernetes-models/gateway-api`, `@kubernetes-models/traefik`, or other installed packages already export a matching interface (e.g. `IPersistentVolumeClaimTemplate`, `IPodSpec`, `IServicePort`). Hand-roll types only when no package provides them.

### Infrastructure

- NAS: IP `192.168.53.120`, base path `/mnt/tank/data`. Hardcoded in `modifiers.ts` and `storage.ts`.
- Private registry mirror: `zot.int.lab53.net` (pull-through cache for Docker Hub, ghcr.io, quay.io, registry.k8s.io and docker.dragonflydb.io).

### Image sources

- Every container image and Helm chart version is declared in `versions.ts` (`images`, `postgresImages`, `helmCharts`) and consumed via `image(key)`, `postgresImage(major)` and `HelmRelease.chart` keys. Do not write image strings in `apps/*.ts`.
- **Mirroring**: every entry sets `mirrored`. `true` renders `zot.int.lab53.net/<prefix>/<path>:<tag>` (the zot app, `apps/zot.ts`), where the prefix comes from `mirrorPrefixes` in `constants.ts` and must match the sync `destination` in `apps/zot/config.json`. `false` renders the upstream name unchanged. `mirrorRepository(name)` in `utils.ts` does the same mapping for images set in Helm values.
- **Registries** are the `ImageRegistry` union in `versions.ts` (docker.io, ghcr.io, quay.io, registry.k8s.io, docker.dragonflydb.io). Adding one means extending the union, `mirrorPrefixes`, and a sync entry in `apps/zot/config.json`.
- `versions.ts` is parsed by Renovate regexes: keep the exact field order and one-entry-per-object shape, then run `bun run check-versions` and `bun run typecheck`.
- Exceptions: digest-pinned images (`apps/iso-archive.ts`) and images inside YAML files (`cluster/*.yaml`, `apps/*/values.yaml`).
- ArgoCD CMP sidecar: `oven/bun` image, plugin name "ts", discovery key `main.ts`.
- `cluster/` holds only what bootstraps ArgoCD (its Helm values and the root Application), applied by hand. Everything else, including kube-vip and Traefik, is an ArgoCD app under `apps/`; nothing is copied to the k3s server manifest directory.
- **kube-vip** (`apps/kube-vip.ts`, `kube-system`) holds the API server VIP `192.168.53.200` and the Traefik VIP `192.168.53.201`. Its resources carry `Prune=false,Delete=false` so removing the app or a file never deletes the VIP provider, and a rollout fails both VIPs over one node at a time, so merge changes to it deliberately. Renovate bumps are PR-only. Its image is on ghcr.io, not the mirror, because the mirror is served through the VIP.

## Dependency updates (Renovate)

Mend Renovate (GitHub App) opens PRs for images, charts and npm packages from `renovate.json`. Merging updates git and Argo auto-syncs every Application (`prune: true`, `selfHeal: false`, `CreateNamespace=true`, retry with backoff), so a merged PR is applied without a manual sync. Set `autoSync: false` on an app (e.g. work in progress) to omit `automated` and sync it by hand.

- **What it reads:** custom regex managers over `versions.ts` (images, repo charts, OCI charts; `depType` `image` / `helm-chart`), the built-in `helm-values` manager over `apps/**/*values.yaml`, `bun` (`package.json`/`bun.lock`) and `github-actions`. `cluster/**` is ignored (manual), and the ArgoCD chart is pinned by `--version` in the `install-argo` script, so Renovate never sees it.
- **`versions.ts` shape:** the regexes live in `renovate.json` and `scripts/check-versions.ts` reads them from there. Keep the file Prettier-formatted, one entry per object, fields in the existing order, no computed values. Run `bun run check-versions`.
- **Timing:** Docker Hub, Helm-repo and npm updates are created once a version is 7 days old (`minimumReleaseAge`). `ghcr.io`, `quay.io` and `docker.dragonflydb.io` expose no registry-provided release date, so a rule sets `minimumReleaseAgeBehaviour: timestamp-optional` and they skip the age check. Updates are only created in the weekly window (before 6am Saturday, America/New_York). The Dependency Dashboard issue is not schedule-bound.
- **Verify:** `.github/workflows/verify.yml` (required check `verify`) runs typecheck, Prettier, `check-versions`, `render-all` and `render-charts` (`helm template` for every app with `helmReleases`, so a chart that rejects our values fails the check). On PRs it posts a sticky comment with the rendered-manifest and chart diff against the base, and a failure banner if a chart does not render.

| Update        | Behaviour                                                     |
| ------------- | ------------------------------------------------------------- |
| patch, digest | auto-merge (GitHub auto-merge once `verify` is green)         |
| minor         | auto-merge                                                    |
| major         | PR only, `needs-review` label                                 |
| denylist      | PR only, always                                               |
| disabled      | no PR (`whisper.cpp`, `immich-app/postgres`, Postgres majors) |

- **Where the lists live:** the denylist is a pair of `matchPackageNames` rules in `renovate.json`; every minor auto-merges unless it is on the denylist or a major, and charts follow the same rules as images. Denylist: immich (chart + server image, grouped), pocket-id (operator chart + image), cert-manager and trust-manager charts, external-secrets, volsync, home-assistant, kube-vip. Groups: `immich`, `typetype`, `bun` (image + `bun-types`).
- **Vulnerability alerts** are disabled so security updates follow the same rules.
- PR titles must stay within 80 characters; `commitMessageTopic` is `{{{depName}}}` to keep long OCI names short.

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
- `apps/apprise.ts` → `appriseUrl`, `appriseNotifiers`
- `apps/healthchecks.ts` → `healthchecksUrl`
- `waf.ts` → `wafProfiles`, `resolveWaf`, `buildWafMiddleware`, crowdsec namespace and secret names
- `apps/traefik/externalApps.config.ts` → `externalApps`, helper functions

## Agent skills

### Issue tracker

GitHub Issues on `aaronkyriesenbach/catalyst`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
