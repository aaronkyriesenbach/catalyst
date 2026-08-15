# Research: notify-only image-update tooling for catalyst

Ticket: [#27](https://github.com/aaronkyriesenbach/catalyst/issues/27) (part of wayfinder map #1)

## Question

Survey notify-only (no auto-apply) image-update tooling for the `catalyst` repo, where
container image references live as plain string literals inside TypeScript `apps/*.ts`
files rather than `values.yaml` or Kubernetes manifests. Evaluate Dependabot, Renovate,
ArgoCD Image Updater (notification-only mode), and other viable options, focused on how
well each can actually parse/track image tags embedded in `.ts` source.

## The exact shape of the problem

Surveyed several files under `apps/*.ts` in the main worktree. Image references appear in
at least three shapes:

1. **Inline string literal inside a container object** (the overwhelming majority):

   ```ts
   // apps/restic-server.ts
   image: "docker.int.lab53.net/restic/rest-server:0.14.0",

   // apps/registry.ts
   image: "registry:2",

   // apps/navidrome.ts
   image: "ghcr.io/navidrome/navidrome:0.62.0",
   ```

2. **Named `const` holding the literal**, one level removed from the container spec:

   ```ts
   // apps/external-cert-deployer.ts
   const image = "docker.int.lab53.net/oven/bun:1.3.14";
   ```

3. **Composed/templated at call time — no literal tag string exists anywhere in the repo**:

   ```ts
   // modifiers.ts (withPostgres)
   const DEFAULT_POSTGRES_REGISTRY = "docker.int.lab53.net/library/postgres";
   const image =
     options?.image ?? `${DEFAULT_POSTGRES_REGISTRY}:${version}-${variant}`;

   // apps/miniflux.ts
   withPostgres(18, { backup: true }),   // version is a bare numeric literal argument
   ```

   Here the actual `image:` field the pod gets is assembled from a template literal at
   runtime; the only textual trace of the version is the numeral `18`/`16` passed into
   `withPostgres(...)`, and the registry/variant live in `modifiers.ts`, not the app file.

4. **HelmChart apps reference an OCI chart URL with no tag in the string at all** (e.g.
   `apps/cert-manager.ts`: `chart: "oci://quay.io/jetstack/charts/cert-manager"`) — the
   chart version and any images it renders live in an embedded `values.yaml` blob or Helm
   defaults, not as a scannable string in the `.ts` file.

Shape 1 and 2 are trivially regex-matchable. Shape 3 requires a bespoke, fragile regex
tied to this repo's specific modifier convention. Shape 4 is out of scope for any
image-updater and would need chart-version tracking instead.

There is no existing `.github/dependabot.yml` or `renovate.json` in the repo today.

---

## Dependabot

**Source:** GitHub Docs, [Dependabot options reference](https://docs.github.com/en/code-security/reference/supply-chain-security/dependabot-options-reference) and [Ecosystems supported by Dependabot](https://docs.github.com/en/code-security/reference/supply-chain-security/supported-ecosystems-and-repositories).

- Dependabot's `docker` `package-ecosystem` "can update Docker image tags in Kubernetes
  manifests. Add an entry to the Docker `package-ecosystem` element of your
  `dependabot.yml` file for each directory containing a Kubernetes manifest which
  references Docker image tags. Kubernetes manifests can be Kubernetes Deployment YAML
  files or Helm charts." It also parses `Dockerfile` and `docker-compose` (v2/v3) files
  directly. There is **no ecosystem for arbitrary source files, custom regex managers, or
  TypeScript** — Dependabot's ecosystem list is fixed (bazel, bun, cargo, deno,
  devcontainers, docker, docker-compose, npm, pip, terraform, etc.), each tied to a
  specific manifest/lockfile format it knows how to parse and rewrite.
- Because `catalyst` has no Dockerfile, docker-compose file, or plain Kubernetes YAML
  manifest — only TypeScript files that *generate* manifests at render time — none of
  Dependabot's ecosystems have anything to attach to. It cannot see the `image:` string
  literals in `apps/*.ts` at all.
- Even where it does apply, Dependabot has **no dedicated "notify only" mode**. Per the
  options reference, `open-pull-requests-limit` only controls how many *pull requests*
  stay open; setting it to `0` "temporarily disable[s] version updates for a package
  manager" entirely — it does not produce a notification-without-a-PR, it just stops
  checking. Dependabot's model is fundamentally "detect update → open a PR"; there is no
  built-in dashboard/report-only surface analogous to Renovate's.

**Verdict: not viable.** Wrong parsing model (fixed ecosystems, no custom-file support)
and no notify-only mode even where it would apply.

---

## Renovate

**Sources:** Renovate docs, [Custom Manager Support using Regex](https://docs.renovatebot.com/modules/manager/regex/) (source: `renovatebot/renovate` `lib/modules/manager/custom/regex/readme.md`) and [Configuration Options](https://github.com/renovatebot/renovate/blob/main/docs/usage/configuration-options.md) (`dependencyDashboard`, `dependencyDashboardApproval`, `prConcurrentLimit`).

### Parsing `.ts` image literals

Renovate's built-in `docker`/`kubernetes` managers only match specific filenames/patterns
(Dockerfiles, k8s manifests, docker-compose, Helm values, etc.) and would not pick up
`apps/*.ts`. However, Renovate ships a first-class **`regex` custom manager**
(`customManagers` with `customType: "regex"`) explicitly designed for "dependencies that
are not detected by its other built-in package managers." Key facts from the docs:

- You configure `managerFilePatterns` (a glob/regex over file paths — can target
  `apps/**/*.ts` directly) and one or more `matchStrings` regexes with **named capture
  groups**.
- Required capture groups: `currentValue` (the version/tag to bump) plus a way to
  identify the dependency — either a `depName`/`packageName` capture group or the
  corresponding `*Template` config field — and a `datasource` (e.g. `docker`).
- Renovate's regex engine is RE2-based (via `uhop/node-re2`), matched **per file, not
  per line** (so `^`/`$` anchor the whole file unless you use `(?:^|\r\n|\r|\n|$)`), and
  it does **not** support backreferences or lookahead.
- Optional capture groups let you set `registryUrl`, `versioning`, `extractVersion`,
  `currentDigest`, etc., and everything after capture is composed via Handlebars
  `*Template` fields.

Applied to catalyst's shapes:

- **Shape 1/2** (`image: "docker.int.lab53.net/restic/rest-server:0.14.0"`, `const image
  = "docker.int.lab53.net/oven/bun:1.3.14"`) — straightforward. A single
  `matchStrings` regex like
  `image:\s*["'](?<depName>[^:"']+):(?<currentValue>[^"']+)["']` with
  `datasourceTemplate: "docker"` (registry inferred from the `depName` prefix, same as the
  built-in `docker` datasource does for `ghcr.io/...`, `docker.int.lab53.net/...`, etc.)
  handles essentially every `apps/*.ts` file surveyed, including bare-name images like
  `registry:2`.
- **Shape 3** (`withPostgres(18, ...)` / templated image in `modifiers.ts`) — not
  reliably matchable by a generic rule. It would need a repo-specific regex keyed to the
  `withPostgres(` call convention (capturing the bare numeral as `currentValue`, with a
  hardcoded `packageNameTemplate` pointing at the postgres image and `versioning` set to
  match the major-version-only scheme), maintained by hand as the modifier's signature
  evolves. Doable, but bespoke and fragile — exactly the kind of case the regex-manager
  docs' "Advanced Capture" / `# renovate:` comment-annotation pattern exists to handle
  (annotate the call site with a `// renovate: datasource=docker packageName=...` comment
  so the regex only has to capture the version, not infer everything).
- **Shape 4** (HelmChart `oci://` refs) — out of scope for an image updater; would need
  Renovate's built-in Helm/OCI chart-version datasource support instead, tracking chart
  version rather than a container image tag.

### Notify-only mode

Renovate has a **documented, first-class notify-only workflow** via the Dependency
Dashboard:

> "By setting `dependencyDashboardApproval` to `true` in config (including within
> `packageRules`), you can tell Renovate to wait for your approval from the Dependency
> Dashboard before creating a branch/PR." Setting it `true` globally also auto-enables
> the Dependency Dashboard issue creation, so no separate `dependencyDashboard: true` is
> needed. ([Configuration Options — `dependencyDashboardApproval`](https://github.com/renovatebot/renovate/blob/main/docs/usage/configuration-options.md))

This produces exactly the desired UX for a single-operator homelab: Renovate opens/keeps
updated a single "Dependency Dashboard" GitHub issue listing every pending update it has
detected (including ones matched by the custom regex manager), and creates **no branch or
PR** until the operator manually checks a box on that issue. That is a notification, not
an auto-apply — the operator stays in full control of when/if anything merges.

**Verdict: best fit.** Its `regex` custom manager is purpose-built for exactly this
"arbitrary source file, string literal" scenario, it covers the two dominant literal
shapes in the repo without much bespoke work, and `dependencyDashboardApproval: true`
gives a documented, native notify-only mode. The templated postgres-version case (shape
3) would need a small amount of hand-written, repo-specific regex/annotation work, and
HelmChart `oci://` chart versions would need Renovate's separate Helm-datasource support
rather than the image-focused regex rule.

---

## ArgoCD Image Updater (notification-only mode)

**Source:** `argocd-image-updater` official docs (argoproj-labs), [`docs/index.md`](https://github.com/argoproj-labs/argocd-image-updater/blob/master/docs/index.md) and [`docs/basics/update-methods.md`](https://github.com/argoproj-labs/argocd-image-updater/blob/master/docs/basics/update-methods.md).

### Fundamental architecture mismatch

From the docs' own "Limitations" section:

> "Argo CD Image Updater can only update container images for applications whose
> manifests are rendered using *Kustomize*, *Helm*, or a *Config Management Plugin*. For
> Helm, the templates need to support specifying the image's tag (and possibly name)
> using a parameter (i.e. `image.tag`). Plugin apps can be configured in two ways: using
> `manifestTargets.plugin` (the plugin reads image configuration from environment
> variables in the Application source), or using `manifestTargets.helm` or
> `manifestTargets.kustomize` with the git write-back method (the plugin reads from
> Kustomization or Helm values files committed to Git)."

`catalyst`'s CMP plugin (`main.ts`) reads TypeScript files and does not expose image
configuration through `spec.source.plugin.env` variables, nor does it read image tags
back out of a committed `kustomization.yaml` or Helm `values.yaml` — the whole point of
the repo's design is that images are literals baked directly into `apps/*.ts`. That
means **neither of the two supported CMP integration paths applies**: there is no env-var
contract for Image Updater to write into, and no Kustomize/Helm values file for it to
target with git write-back. Image Updater has no mechanism to look inside arbitrary
plugin source files.

### No notification-only mode exists

Separately, and even setting the parsing mismatch aside: Image Updater's documented
[write-back methods](https://github.com/argoproj-labs/argocd-image-updater/blob/master/docs/basics/update-methods.md)
are only:

- `argocd` (default) — "directly modifies the Argo CD `Application` resource in the
  cluster, updating the application's source parameters ... to instruct Argo CD to
  re-render the manifests using those parameters." Pseudo-persistent (lost if the
  Application is re-synced from Git).
- `git` — commits the parameter override permanently into the app's Git repo (either a
  `.argocd-source-<appName>.yaml` file, a `kustomization.yaml` image override, or a Helm
  values file), which Argo CD then picks up and applies.

There is no dry-run, report-only, or "detect but don't write" mode documented anywhere in
the project's docs, and no dedicated notifications integration/doc page in the
repository (checked for `docs/notifications.md` and similar — none exists). Both
write-back methods actively cause Argo CD to apply the new image, contradicting the
"notify only" requirement outright, independent of whether it could even parse the repo.

**Verdict: not viable, twice over.** It cannot see image references embedded in
TypeScript CMP source (no supported write-back target maps to that shape), and even
where it can operate it has no way to only notify without applying the change.

---

## Other viable option: Diun (Docker Image Update Notifier)

**Source:** Diun official docs, [Home](https://crazymax.dev/diun/) and [Kubernetes provider](https://crazymax.dev/diun/providers/kubernetes/).

Diun sidesteps the whole "can it parse TypeScript" problem by not reading the repo at
all. Per its own description:

> "**D**ocker **I**mage **U**pdate **N**otifier helps you keep track of container image
> updates without manually watching registries. Diun checks your images on a schedule,
> detects when a tracked tag or digest has changed, and notifies you when something new
> is available."

Its **Kubernetes provider** "allows you to analyze the pods of your Kubernetes cluster to
extract images found and check for updates on the registry" — i.e. it introspects the
*live, already-rendered* Pod specs via the Kubernetes API, not the source that generated
them. Since it works off runtime state rather than source text, it is completely immune
to how `catalyst` expresses image references in `.ts` (string literal, `const`, or
template-composed — doesn't matter, by the time a Pod exists the image string is fully
resolved). Notifications go out purely to messaging channels (Slack, Discord, Telegram,
ntfy, Gotify, webhook, etc. — see [Notifications](https://crazymax.dev/diun/) index); Diun
has no write-back/apply capability of any kind, so it is inherently notify-only by
design, not by opt-in configuration.

Trade-off versus Renovate: Diun tells you an image *running in the cluster* has an
update available, but doesn't link that back to a `git` diff/PR showing exactly which
line in which `apps/*.ts` file to change — the operator has to go find and edit the
literal by hand. Renovate's regex-manager + Dependency Dashboard approach, by contrast,
already stages the exact file edit and just waits for manual approval to open the PR.

**Verdict: viable, complementary.** Good low-effort, zero-parsing option for "just tell
me when something upstream changed," especially for images that don't fit either
Renovate's regex manager or the postgres-style templated shape (shape 3, shape 4).
Weaker than Renovate for turning a notification directly into an actionable diff.

---

## Recommendation

1. **Adopt Renovate** with `dependencyDashboardApproval: true` (global) as the primary
   tool. Use a `regex` custom manager targeting `apps/**/*.ts` (and `modifiers.ts`) with
   a `datasourceTemplate: "docker"` rule matching the `image: "…"` / `const image = "…"`
   literal shape — this alone covers the large majority of images in the repo. It gives
   native, documented notify-only behavior (a single Dependency Dashboard issue, no PRs
   until manually approved) and produces an actionable diff when approved.
2. For the templated `withPostgres(...)` case, either accept it's not covered
   automatically, or add a small bespoke regex rule (or `# renovate:` annotation comment
   at each `withPostgres(...)` call site) — low volume (2 call sites today), not worth
   over-engineering.
3. **Dependabot is not viable** — no ecosystem covers hand-rolled `.ts` source, and it has
   no notify-only mode regardless.
4. **ArgoCD Image Updater is not viable** — the repo's CMP plugin shape doesn't match
   either of its supported write-back targets (Application `plugin.env` vars or
   Kustomize/Helm values files), and it has no notify-only mode in any case — every
   configuration actively applies an update.
5. **Diun is a reasonable complementary/fallback option** if a zero-configuration,
   zero-parsing "just watch the cluster and ping me" notifier is preferred over
   maintaining Renovate regex rules, at the cost of not producing a ready-to-approve diff.
