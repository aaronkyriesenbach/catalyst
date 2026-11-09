# PROJECT KNOWLEDGE BASE

Kubernetes infrastructure-as-TypeScript repo. Defines cluster apps as typed configs (`AppConfig`) that ArgoCD renders into manifests via a Bun-based CMP plugin. Domain: `lab53.net`. This file covers the framework; each cluster's own services and wiring are in `clusters/<name>/AGENTS.md`.

## STRUCTURE

```text
catalyst/
├── main.ts                  # CMP entrypoint: single app (ARGOCD_ENV_APP = file name) or enumerate every app of the target cluster
├── site.ts                  # Site-wide facts shared by every cluster: domain, NAS, mirror, Cloudflare zone, LimitRange defaults
├── clusters/
│   └── cluster0/            # One directory per cluster; everything about that cluster lives here
│       ├── cluster.ts       # Cluster definition: network, VIPs, tunnel, Argo projects
│       ├── apps/            # Each top-level *.ts exports default AppConfig (apps/<name>/ holds its values, scripts, helpers)
│       ├── infra/           # Infrastructure that can be applied by an infrastructure tool like Pulumi or OpenTofu
│       ├── bootstrap/       # Manually-applied config/infra, if there is any. An IaC tool (above) should always be used if possible.
│       ├── tools/           # Cluster-specific CLIs (sync-external-certs)
│       └── AGENTS.md        # Services and wiring specific to this cluster
├── packages/                # Libraries, imported as @catalyst/<package>/<module>; never import from clusters/
│   ├── core/                # types, app loader and catalog, render pipeline, validation, cluster selection
│   ├── k8s/                 # Builders: workload, route, secrets, storage, probes, cron, backup
│   ├── argocd/              # Application and AppProject builders
│   ├── platform/            # auth (authentik), waf, status, notifications, hostnames, modifiers
│   └── versions/            # versions.ts (Renovate-parsed image and chart registry) and image() helpers
├── tools/                   # Dev CLIs: render, render-all, render-chart(s), diff-renders, check-versions, validate
├── docs/                    # Design docs and ADRs
└── irsa.md                  # IRSA setup docs (AWS OIDC, S3, IAM)
```

## COMMANDS

```bash
bun run render <app-name>                    # Render single app to stdout YAML (verify changes)
bun run sync-external-certs [--dry-run]      # Pull TLS certs from cluster via kubectl
bun run typecheck                            # tsc --noEmit
bun run validate                             # Render every app and fail on a hostname served by two HTTPRoutes (remote resources and Helm charts are not rendered)
bun run render-all <outdir>                  # Render every app + project + enumerate-all into <outdir> (what CI runs)
bun run render-charts <outdir>               # render-chart for every app with helmReleases (needs helm)
bun run check-versions                       # Verify versions.ts matches the Renovate-parsed format
bun run install-argo                         # helm upgrade --install ArgoCD with custom values
bunx prettier --write .                      # Format the repo (config: .prettierrc, .prettierignore)
```

**kubectl access**: The agent has `kubectl` configured and may query the cluster to verify live state — CIDR ranges, services, nodes, etc.

**Verification**: Always run `bun run render <app-name>` after editing an app file to confirm valid YAML output. A change that should not alter manifests (a refactor) must leave `bun run render-all` output identical: render before and after and `diff -r`.

## CONVENTIONS

### Clusters and sites

- **One directory per cluster** under `clusters/`. The target cluster is `ARGOCD_ENV_CLUSTER`; with a single cluster directory it defaults to that one. `import { cluster } from "@catalyst/core/cluster"` gives the target cluster's definition, and `cluster.name` is the directory name (`cluster.ts` does not declare it).
- **`site.ts` vs `cluster.ts`**: `site.ts` holds facts that are the same for every cluster (domain, NAS, mirror, Cloudflare zone). `cluster.ts` holds what varies per cluster (pod and service CIDRs, VIPs, tunnel id, Argo projects, unmanaged namespaces, unmirrored chart images). Values another toolchain (OpenTofu, Omni) also needs belong in a plain YAML file both can read, not in either TS file.
- **Packages never import from `clusters/`**. They read the target cluster through `@catalyst/core/cluster`; an app reads the same singleton.
- **Placement is the directory**: an app runs on the cluster whose `apps/` directory contains it. There is no `cluster` field and no registry.

### App System

- **App discovery**: the loader reads `clusters/<cluster>/apps/` with `readdirSync`, sorted by name, filtering `entry.isFile()`. Only top-level `.ts` files are discovered — not subdirectories. Imports stay sequential: concurrent imports race Bun's auto-install in the CMP, which has no `node_modules`.
- **Default export required**: the loader reads `mod.default`. Named-only exports will silently produce no config.
- **Name equals file name**: the CMP loads `${ARGOCD_ENV_APP}.ts` while the Application is named from `config.name`. Keep them equal; nothing checks it.
- **Two app kinds**: `WorkloadApp` (auto-generates Deployment+Service+HTTPRoute from `podSpec`) and `StaticApp` (explicit `resources` array).
- **App namespace**: Defaults to `name` when `namespace` is omitted.
- **Security context**: `renderWorkload` auto-applies `runAsNonRoot: true, runAsUser/Group: 1000` if `podSpec.securityContext` is not set. Set it explicitly to override.
- **Output that depends on other apps** goes in `derive: ({ catalog, cluster }) => ({ resources | extraResources, helmReleases })`. It runs at render time against every app's declaration and its result is appended to the declared lists, so modifiers still compose with it. `catalog.entries` holds every app on every cluster (`{ cluster, file, config }`) and `catalog.onCluster(cluster.name)` one cluster's apps. A `derive` sees other apps' declarations but never their `derive` output, so two aggregating apps cannot form a cycle; never import another app's module to read it. authentik (OIDC clients), Gatus (checks) and limit-ranges (namespaces) use it.
- **Sharing constants between apps**: put them in the owning app's `common.ts` (`apps/<app>/common.ts`), which imports nothing from other apps, and import that. Never import another app's top-level module.

### Modifiers (WorkloadApp only)

- Compose via `applyModifiers(base, ...modifiers)` — each modifier is an immutable transform.
- `withNasMounts(config)` — adds NFS volume + mounts keyed by container name. Throws if container name doesn't exist.
- `withPostgres(version, options?)` — adds a postgres StatefulSet `<app>-postgres` with an iSCSI-backed PVC and a headless Service, addressable at `<app>-postgres:5432`, plus restic backup resources with `backup: true`. `version` is restricted to the majors in `postgresImages` (`versions.ts`); the image comes from there (mirrored `library/postgres:<major>-alpine`) unless `options.image` overrides it.
- `withForwardAuth({ skipPathRegex? })` — puts the app behind authentik forward auth (embedded outpost). Sets `oidc: { kind: "proxy" }`; `renderWorkload` then emits the `forward-auth` Middleware and `buildRoute` the outpost rule and filter. No secret involved.
- `withOidcClient({ redirectPaths, rotate? })` — for apps that run their own OIDC flow. Sets `oidc: { kind: "oauth2" }` and emits the `<app>-oidc-credentials` ExternalSecret (`client_id`, `client_secret`, `issuer_url`). `apps/authentik.ts` creates the confidential client and its rotating secret (default every 90 days, `DEFAULT_CLIENT_SECRET_ROTATION`; `rotate: false` for an app that stores the secret itself). `StaticApp`s use `defineOidcClient(name, options)` and put its `oidc` and `credentialsSecret` on the app. See Identity (authentik) in the cluster file. An app that serves several hostnames (the arr stack) registers the extra ones, each with its own group and provider, in `additionalOidc` and builds their routes and the `forward-auth` Middleware itself.
- `withOidcPublicClient({ redirectPaths })` — for a browser app that signs in with PKCE and holds no secret (Stalwart's web UI). Sets `oidc: { kind: "oauth2-public" }`: authentik creates a public provider whose `client_id` is the app name, and no secret or `<app>-oidc-credentials` is generated.

### Rollouts and probes

- `buildDeployment`/`buildStatefulSet` throw unless some container has a `readinessProbe`, because without one a pod is Ready at container start and the old pod is dropped immediately. Set `probeExempt: "<reason>"` (on `WorkloadApp` or the builder options) only when nothing can be probed.
- Build probes with `packages/k8s/probes.ts` (`readiness`, `startup`, `httpCheck`/`tcpCheck`/`execCheck`) instead of hand-writing them. Prefer the app's real health endpoint; use `tcpCheck` on the web port when `/` needs auth or returns non-2xx/3xx. Add `startup(..., budgetSeconds)` for slow boots rather than `initialDelaySeconds`.
- Deployments default to `RollingUpdate` (`maxSurge: 1`, `maxUnavailable: 0`), `minReadySeconds: 15` and `progressDeadlineSeconds: 300`. Raise `progressDeadlineSeconds` on the app when startup plus image pulls can exceed that.
- `withIscsiVolumes` forces `Recreate` (RWO volume); those apps have a short outage on every rollout. NFS-only apps may overlap.
- external-dns stays `Recreate`: upstream says it has no leader election and must not run duplicate instances.

### Resource requests and limits

`apps/limit-ranges.ts` generates a `LimitRange` named `defaults` in every namespace an app on the cluster deploys into (plus `gitops.unmanagedNamespaces` from `cluster.ts`: argocd, default, kube-system). It fills in `site.defaultContainerResources` for any container that sets neither request nor limit, so Git never needs to repeat the defaults. Every app therefore gets default requests and limits automatically. An app that needs something different must set **both** requests and limits explicitly, on the container or in chart values, because a partial setting is completed from the defaults (a request above the default limit with no limit is rejected by the API). LimitRange applies at pod creation only, so existing pods keep running unbounded until they restart. A namespace created in the same sync as its LimitRange fails the first attempt and succeeds on retry; pods started in between have no defaults. `clusters/cluster0/bootstrap/argocd-values.yaml` is applied by hand, so its resource values take effect after `bun run install-argo`.

### Secrets

- Every AWS Secrets Manager key is `lab53/<cluster name>/<namespace>/<secret name>`. Build it with `awsRemoteKey(namespace, name)` (a key that must already exist or another app generates) or let `buildGeneratedSecret`/`buildBackupResources` build it (generated). Never type a key as a string: the cluster name comes from `cluster.ts`, so a renamed cluster changes every key and its persisted secrets would regenerate.
- `buildGeneratedSecret(namespace, name, keys, options?)` in `packages/k8s/secrets.ts` creates ExternalSecret + optional per-key Password generators.
- Depends on the `external-secrets` app being installed (`apps/external-secrets.ts`); the store and generator names it relies on are defined in `packages/k8s/external-secrets.ts`.
- Keys can be strings (use cluster-wide default generator) or objects with `{ key, length?, encoding? }`.
- `{ persist: true }` seeds the value into AWS once and reads it back, so every namespace (and a rebuilt cluster) sees the same value. Use one key per call: seeding skips the whole AWS secret once any property exists.
- `{ persist: true, rotate: "<duration>" }` regenerates and overwrites the AWS value on that interval (`PushSecret` `Replace`) and makes the consumers re-read every minute. Only for values both sides re-read (OIDC client secrets). TODO in `buildSeedPushSecret`: move to a cron schedule once external-secrets supports it.

### Helm Charts

- Declare charts with `helmReleases: [{ chart, releaseName, values?, parameters?, skipCrds? }]` on the app. `buildApplication` turns each release into a native ArgoCD Helm source (multi-source Application), so chart resources are tracked by Argo with diffs in its UI. Helm is **not** in the CMP sidecar, and the k3s `HelmChart` CRD is not used for apps.
- Chart repo/name/version live in `helmCharts` in `packages/versions/versions.ts` (`chart` is a `HelmChartKey`). Never write repo URLs or versions in `apps/*.ts`.
- `releaseName` must equal the live Helm release name when adopting an existing install. Charts install into the app's destination namespace (`namespace ?? name`).
- Load values from a file with `await readYaml("./app/values.yaml", import.meta.url)`; `--set` equivalents go in `parameters`.
- When several releases of one chart share a namespace, set `skipCrds: true` on all but one so a `crds/` directory is not rendered twice.
- Use `ignoreDifferences` (typed from `@kubernetes-models/argo-cd`) for fields written at runtime by controllers. Apps with `helmReleases` also get `ServerSideApply=true` and `ServerSideDiff=true`.
- `bun run render <app>` only shows CMP-rendered resources. Chart output is visible in ArgoCD (`argocd app manifests <app>`) or via `bun run render-chart <app>` (needs the `helm` CLI; an approximation of Argo's output). Helm generates random certificates and passwords on every run for some charts (victoria-metrics), so two chart renders of identical code differ in those values.

### Scripts and embedded files

- Never inline shell scripts in `apps/*.ts`. Put them in a file next to the app (e.g. `apps/<app>/<name>.sh`), load with `readFile(...)` into `buildFileConfigMap(...)`, mount the ConfigMap, and run it with `command: ["/bin/sh", "/scripts/<name>.sh"]`. Pass values the script needs as container `env`, not TS string interpolation, so the file stays a plain, lintable script.
- Indent anything embedded in a ConfigMap with **spaces, not tabs** (`.editorconfig` enforces this for `*.sh`). A tab makes Go/JS YAML encoders (kubectl, ArgoCD UI) render the whole value as one quoted `\n`-escaped string.

### Runtime & TypeScript

- **Bun only**. Scripts use `Bun.spawn`, `Bun.file`, `Bun.write`. Bun-compatible `node:` imports are fine.
- Strict mode, `noUncheckedIndexedAccess`, ES2022 target, ESM, `moduleResolution: bundler`.
- **Imports**: `@catalyst/<package>/<module>` for packages and `@catalyst/site` for `site.ts` (`tsconfig` `paths`; Bun resolves them at runtime, so the CMP needs no `node_modules` link). Use relative imports only inside one app directory or one package. Do not add `baseUrl`: TypeScript 7 rejects it.
- No linter or unit tests. CI (`verify.yml`) runs typecheck, Prettier, `check-versions`, `validate`, `render-all` and `render-charts`; the CMP plugin renders in-cluster.
- **Formatting**: Prettier is a devDependency, configured via `.prettierrc` (explicit defaults) and `.prettierignore` (`node_modules/`, `downloads/`, `bun.lock`, `.sisyphus/`, `.omo/`). Run `bunx prettier --write .` before committing.
- **Prefer imported types over hand-rolled ones.** Before defining a new type, check whether `kubernetes-models`, `@kubernetes-models/gateway-api`, `@kubernetes-models/traefik`, or other installed packages already export a matching interface (e.g. `IPersistentVolumeClaimTemplate`, `IPodSpec`, `IServicePort`). Hand-roll types only when no package provides them.

### Image sources

- Every container image and Helm chart version is declared in `packages/versions/versions.ts` (`images`, `postgresImages`, `helmCharts`) and consumed via `image(key)`, `postgresImage(major)` and `HelmRelease.chart` keys. Do not write image strings in `apps/*.ts`.
- **Mirroring**: every entry sets `mirrored`. `true` renders `zot.int.lab53.net/<prefix>/<path>:<tag>` (the zot app, `apps/zot.ts`), where the prefix comes from `site.mirror.prefixes` in `site.ts` and must match the sync `destination` in `apps/zot/config.json`. `false` renders the upstream name unchanged. `mirrorRepository(name)` in `@catalyst/versions/images` does the same mapping for images set in Helm values.
- **Registries** are the `ImageRegistry` union in `versions.ts` (docker.io, ghcr.io, quay.io, registry.k8s.io, docker.dragonflydb.io). Adding one means extending the union, `site.mirror.prefixes`, and a sync entry in `apps/zot/config.json`.
- `versions.ts` is parsed by Renovate regexes: keep the exact field order and one-entry-per-object shape, then run `bun run check-versions` and `bun run typecheck`.
- Exceptions: digest-pinned images (`apps/iso-archive.ts`) and images inside YAML files (`bootstrap/*.yaml`, `apps/*/values.yaml`) that are not Helm chart images.
- **Chart images** are mirrored through `parameters`, not by editing `apps/*/values.yaml`, so Renovate keeps reading the upstream repository and tag from the YAML. Set each image's `repository` key (or the chart's registry key) to `mirrorRepository(...)`. An image that is a single `repo:tag` string in a CR lives in `versions.ts` and is passed as `image(key)`.
- **Unmirrored chart images**: `render-chart` fails when a release renders an image outside `zot.int.lab53.net` that is not in `gitops.unmirroredChartImages` (`cluster.ts`), which lists the releases zot's startup depends on (traefik, external-secrets, cert-manager, external-dns-int) with the reason for each. `helm test` hooks and CRDs are not scanned.
- ArgoCD CMP sidecar: `oven/bun` image, plugin name "ts", discovery key `main.ts`.

## Dependency updates (Renovate)

Mend Renovate (GitHub App) opens PRs for images, charts and npm packages from `renovate.json`. Merging updates git and Argo auto-syncs every Application (`prune: true`, `selfHeal: false`, `CreateNamespace=true`, retry with backoff), so a merged PR is applied without a manual sync. Set `autoSync: false` on an app (e.g. work in progress) to omit `automated` and sync it by hand.

- **What it reads:** custom regex managers over `packages/versions/versions.ts` (images, repo charts, OCI charts; `depType` `image` / `helm-chart`), the built-in `helm-values` manager over `clusters/**/*values.yaml`, `bun` (`package.json`/`bun.lock`) and `github-actions`. `clusters/*/bootstrap/**` is ignored (manual), and the ArgoCD chart is pinned by `--version` in the `install-argo` script, so Renovate never sees it.
- **`versions.ts` shape:** the regexes live in `renovate.json` and `tools/check-versions.ts` reads them from there. Keep the file Prettier-formatted, one entry per object, fields in the existing order, no computed values. Run `bun run check-versions`.
- **Timing:** Docker Hub, Helm-repo and npm updates are created once a version is 7 days old (`minimumReleaseAge`). `ghcr.io`, `quay.io` and `docker.dragonflydb.io` expose no registry-provided release date, so a rule sets `minimumReleaseAgeBehaviour: timestamp-optional` and they skip the age check. There is no schedule: PRs are created as soon as an update passes the age check, so minors and patches roll in one at a time. `prConcurrentLimit` is `0` (unlimited) and `rebaseWhen` is `conflicted`, so open PRs are rebased only on a real conflict instead of after every merge.
- **Verify:** `.github/workflows/verify.yml` (required check `verify`) runs typecheck, Prettier, `check-versions`, `validate`, `render-all` and `render-charts` (`helm template` for every app with `helmReleases`, so a chart that rejects our values fails the check). On PRs it posts a sticky comment with the rendered-manifest and chart diff against the base, and a failure banner if a chart does not render or renders an unmirrored image. `render-all` and `render-charts` run in the base checkout from head's `tools/` and must not import app code, so they list apps by directory scan only (and fall back to a top-level `apps/` for base branches older than `clusters/`).

| Update        | Behaviour                                             |
| ------------- | ----------------------------------------------------- |
| patch, digest | auto-merge (GitHub auto-merge once `verify` is green) |
| minor         | auto-merge                                            |
| major         | PR only, `needs-review` label                         |
| denylist      | PR only, always                                       |
| disabled      | no PR (`immich-app/postgres`, Postgres majors)        |

- **Where the lists live:** the denylist is a pair of `matchPackageNames` rules in `renovate.json`; every minor auto-merges unless it is on the denylist or a major, and charts follow the same rules as images. Denylist: immich (chart + server image, grouped), cert-manager and trust-manager charts, external-secrets, volsync, home-assistant, kube-vip, authentik (chart + server image), Stalwart (server + CLI, grouped), the home-operations Radarr/Sonarr/Lidarr/Prowlarr images (they publish pre-releases under normal tags; `allowedVersions` pins Sonarr 4, Radarr 6, Lidarr 3.1). Groups: `immich`, `typetype`, `bun` (image + `bun-types`).
- **Vulnerability alerts** are disabled so security updates follow the same rules.
- PR titles must stay within 80 characters; `commitMessageTopic` is `{{{depName}}}` to keep long OCI names short.

## ANTI-PATTERNS

- **No `index.ts` in `clusters/*/apps/`** — the loader filters `entry.isFile()`, directories with index exports won't be discovered.
- **No named-only exports** — the loader reads `mod.default`. Apps that only export named values produce nothing.
- **No `HelmChart` CRD resources for apps** — use `helmReleases`; the helm-controller would own (and on delete, uninstall) the release.
- **Don't add apps to a registry** — discovery is automatic from the cluster's `apps/` directory.
- **Don't import another app's module or scan every app at module top level** — use `derive`; a top-level `loadAllAppConfigs` in an app is a cycle waiting to happen.
- **Don't import from `clusters/` inside `packages/`** — read the target cluster through `@catalyst/core/cluster`.
- **Don't write `lab53/<cluster>/...` keys by hand** — use `awsRemoteKey` so the cluster name stays in one place.

## CROSS-MODULE EXPORTS

Constants that more than one app or tool needs live in a module that imports nothing from other apps:

- `apps/traefik/common.ts` → `traefikNamespace`
- `apps/cert-manager/common.ts` → `certManagerNamespace`, `internalRootCaSecretName`
- `apps/apprise/common.ts` → `appriseName`, `apprisePort`, `appriseUrl`, `appriseNotifiers`
- `apps/gatus/common.ts` → `gatusUrl`, `heartbeatKey`, `heartbeatSecretName`
- `apps/traefik/externalApps.config.ts` → `externalApps`, helper functions
- `packages/platform/waf.ts` → `wafProfiles`, `resolveWaf`, `buildWafMiddleware`, crowdsec namespace and secret names
- `packages/platform/auth.ts` → `authentikUrl`, `authentikHostOptions`, `buildForwardAuthMiddleware`, `oidcIssuer`, `oidcSecretName`, `DEFAULT_CLIENT_SECRET_ROTATION`
- `packages/k8s/external-secrets.ts` → `clusterGenerator`, `awsSecretStore` and their refs

## Agent skills

### Issue tracker

GitHub Issues on `aaronkyriesenbach/catalyst`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context — root `CONTEXT.md` + `docs/adr/`. See `docs/agents/domain.md`.
