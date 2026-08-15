# Research: Container registry options

Ticket: [aaronkyriesenbach/catalyst#16](https://github.com/aaronkyriesenbach/catalyst/issues/16)
(part of the "Homelab platform rearchitecture" wayfinder map, #1)

## Question

Survey container registry options for the rearchitected platform, evaluated against the
current bare `registry:2` Docker Hub pull-through cache (no OIDC auth, no scanning).
Requirements: OIDC-authenticated pulls (ideally against Pocket ID, the cluster's chosen
identity provider), free image scanning if available. Cover Harbor, Zot,
distribution/registry + an auth proxy, GitLab Container Registry, and other viable
alternatives.

## Current state

`apps/registry.ts` runs the stock `registry:2` image (CNCF Distribution, formerly
`docker/distribution`) as a **pull-through cache only**, via
`REGISTRY_PROXY_REMOTEURL=https://registry-1.docker.io`. It has no authentication (anyone
who can reach `docker.int.lab53.net` can pull), no push capability configured for other
registries, no vulnerability scanning, and stores blobs on NAS at `cluster/registry`
(`withNasMounts`).

## Cross-cutting finding: "OIDC-authenticated docker pull" is not what it sounds like

Every registry surveyed below runs into the same wall, rooted in the Distribution v2 auth
spec: a registry challenges clients with `401` + `WWW-Authenticate: Bearer realm=...`, the
client fetches a **bearer token** from a token endpoint, then retries with
`Authorization: Bearer <token>` — there is no redirect/browser step in this handshake
([distribution/distribution `docs/content/spec/auth/token.md`](https://github.com/distribution/distribution/blob/main/docs/content/spec/auth/token.md)).
Docker/Podman/containerd/kubelet cannot perform an interactive OIDC authorization-code
redirect during `docker login` or an image pull. Consequently:

- **Harbor**: users authenticate to the *Harbor UI* via OIDC SSO, but for `docker`/`helm`
  CLI use, Harbor issues a per-user **CLI secret** tied to the OIDC ID token, used as the
  password for `docker login` — not a live OIDC handshake per pull
  ([Harbor docs, "Using OIDC from the Docker or Helm CLI"](https://goharbor.io/docs/latest/administration/configure-authentication/oidc-auth/)).
- **GitLab**: GitLab itself can use generic OIDC as an OmniAuth SSO provider for *user
  login to the GitLab web UI* (Free tier, self-managed)
  ([GitLab docs, "Use OpenID Connect as an authentication provider"](https://docs.gitlab.com/administration/auth/oidc/)),
  but the Container Registry itself is authenticated with a username/password, personal
  access token, deploy token, or CI job token — never a live OIDC token
  ([GitLab docs, "Authenticate with the container registry"](https://docs.gitlab.com/user/packages/container_registry/authenticate_with_container_registry/)).
- **Zot** and stock **distribution/registry** implement only Basic, LDAP-bind, htpasswd,
  and Bearer/token auth in their configs — no built-in OIDC client at all
  ([Zot `authn-authz.adoc`](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/kb/pages/authn-authz.adoc),
  [Zot bearer-auth doc](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/admin-guide/partials/user-guide-chapters/security/security-bearer-auth.adoc)).
- Separately, **Kubernetes' kubelet** pulls images with static `imagePullSecrets`
  (`docker config json`), not interactive login, regardless of registry — so even a
  "fully OIDC" registry would still need long-lived robot/service credentials for in-cluster
  pulls. OIDC only meaningfully protects *human* `docker login`/push/pull sessions
  (developer workstations, CI), not kubelet.

So "OIDC-authenticated pulls against Pocket ID" in practice means: **SSO login backed by
Pocket ID for the registry's own auth/UI, which then mints a derived
token/PAT/robot-account for the actual Docker client handshake** — not a raw
`WWW-Authenticate: Bearer` challenge that redirects to Pocket ID. Also worth noting: Pocket
ID's own repo shows no evidence of a client-credentials / API-key / service-account grant
(no `client_credential`, `api-key`, or `device` code paths found in its source tree) — it is
built around interactive passkey/authorization-code login. That reinforces that any option
needs a "mint a machine token after human SSO login" step, which is exactly the Harbor
CLI-secret / GitLab-PAT pattern.

## Options evaluated

### 1. Harbor

- CNCF-graduated registry; wraps CNCF Distribution, adds Trivy scanning, a Postgres +
  Redis + Core/Portal/Jobservice/Registry component set, project-based RBAC, and native
  **OIDC SSO for the UI** with the CLI-secret mechanism described above
  ([Harbor OIDC docs](https://goharbor.io/docs/latest/administration/configure-authentication/oidc-auth/)).
- **Scanning**: ships Trivy integration out of the box, free/open-source, configurable
  scan-on-push and scheduled "Scan All"
  ([Harbor vulnerability scanning docs](https://goharbor.io/docs/latest/administration/vulnerability-scanning/)).
- **Pull-through cache**: has a first-class "Proxy Cache" project type supporting Docker
  Hub, GHCR, Quay, ECR, GCR, ACR, JFrog, and other Harbor/Distribution registries — direct
  replacement for the current `registry:2` proxy behavior, one project per upstream
  ([Harbor proxy-cache docs](https://goharbor.io/docs/latest/administration/configure-proxy-cache/)).
- **Resource cost**: official minimum is **2 vCPU / 4 GB RAM / 40 GB disk**, recommended
  **4 vCPU / 8 GB RAM / 160 GB disk**
  ([Harbor installation prerequisites](https://goharbor.io/docs/latest/install-config/installation-prereqs/)).
  That is a large jump from a single stateless `registry:2` pod and is the main cost of
  this option in a single-node/single-operator homelab.
- Installable via the official `harbor-helm` chart on Kubernetes.

### 2. Zot

- CNCF Sandbox project; single static Go binary, "batteries included" (auth, scanning,
  GC, dedup) with no external dependencies required
  ([zotregistry.dev home page](https://zotregistry.dev/v2.1.9/)).
- **Auth**: TLS/mTLS, HTTP Basic, LDAP bind, htpasswd, and Bearer/token (against an
  external token server you must run) — **no native OIDC**
  ([Zot `authn-authz.adoc`](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/kb/pages/authn-authz.adoc)).
  Same caveat as everywhere else: an OIDC front-end would have to sit in front as a
  Bearer/token-issuing service, which is nontrivial custom glue.
  Zot does also ship a web UI (`zui`) but this doesn't add an OIDC auth path for the
  registry API itself in the docs reviewed.
- **Scanning**: built-in Trivy-based CVE scanning as a core extension
  (`pkg/extensions/search/cve/trivy` in the [zot source tree](https://github.com/project-zot/zot)),
  free, no separate service to run, queryable via GraphQL/CLI (`zli`)/UI.
- **Pull-through cache**: the `sync` extension supports `onDemand: true` mirroring from a
  remote registry (including `https://docker.io/...`), functionally equivalent to
  `registry:2`'s `REGISTRY_PROXY_REMOTEURL`
  ([Zot sync-registries doc](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/admin-guide/partials/user-guide-chapters/server-configuration/sync-registries.adoc)).
- **Resource cost**: minimal — single binary, no DB/cache/message-queue dependencies,
  closest in footprint to the current setup.
- Official Helm chart exists (`project-zot/helm-charts`).

### 3. distribution/registry + a separate auth proxy

- Stock CNCF Distribution only implements the Bearer/token protocol against an
  externally-run authorization server that you must operate yourself — it has no built-in
  identity provider integration of any kind
  ([distribution/distribution token-auth spec](https://github.com/distribution/distribution/blob/main/docs/content/spec/auth/token.md)).
- The best-known open-source implementation of that external token server,
  [`cesanta/docker_auth`](https://github.com/cesanta/docker_auth) (still active,
  `pushed_at` recent, 1.3k★, not archived), supports Google Sign-In, GitHub Sign-In, LDAP
  bind, static users, and an "external program" hook — but **no generic OIDC provider**
  option, so it cannot talk to Pocket ID out of the box
  ([docker_auth README](https://raw.githubusercontent.com/cesanta/docker_auth/master/README.md)).
  Making it work with Pocket ID would mean writing and maintaining a custom `ext_auth`
  script that calls Pocket ID's OIDC endpoints — real integration work for a component with
  a small, slow-moving community.
- Traefik `forwardAuth`/oauth2-proxy-style middleware (the pattern this repo already uses
  for other apps via `withOidcAuth({ middleware: true })`) **cannot** be layered in front of
  the registry API for pulls: it depends on an HTTP redirect to the IdP for unauthenticated
  requests, which the Docker/OCI client cannot follow. It only works for the human-facing
  registry UI, if any (Zot/Harbor both have one; stock `registry:2` does not).
- **Scanning**: none built-in; would require bolting on a separate open-source scanner
  (e.g., standalone Trivy in a CronJob against the registry) — doable, but is
  effectively re-building a slice of what Zot or Harbor already give you for free.
- Net effect: this path trades the "no extra components" simplicity of `registry:2` for a
  bespoke identity/auth integration with a smaller, less OIDC-friendly ecosystem than
  Harbor or Zot — more assembly required for a worse result.

### 4. GitLab Container Registry

- GitLab (CE/Free, self-managed) supports OIDC as a generic OmniAuth SSO provider for
  **GitLab account login**, so Pocket ID could be wired in for humans logging into the
  GitLab web UI ([GitLab OIDC OmniAuth docs](https://docs.gitlab.com/administration/auth/oidc/)).
  Actual `docker login` to the registry is still done with username/password, a Personal
  Access Token, Deploy Token, Project/Group Access Token, or a CI job token, never a live
  OIDC token ([GitLab container registry auth docs](https://docs.gitlab.com/user/packages/container_registry/authenticate_with_container_registry/)).
- **Scanning**: GitLab's Container Scanning feature is listed as available on the
  **Free** tier for both GitLab.com and GitLab Self-Managed
  ([GitLab container scanning docs](https://docs.gitlab.com/user/application_security/container_scanning/)),
  but it is implemented as a CI/CD job (Trivy-based) that runs against images built/pushed
  in a pipeline — it is not an automatic "scan everything already in the registry"
  scanner the way Harbor/Zot are, and needs GitLab Runners configured.
- **Resource cost**: this is the dominant issue. Running GitLab just to get its Container
  Registry means standing up all of GitLab: official self-managed sizing baseline is
  **8 vCPU / 16 GB RAM** for a single-node install (8 GB RAM is called out as the
  minimum only for memory-constrained setups), plus Postgres, Gitaly repo storage, and
  explicit guidance to avoid NFS-backed storage for performance
  ([GitLab installation requirements](https://docs.gitlab.com/install/requirements/)) — this repo's
  storage model is NAS/NFS-backed (`storage.ts`), which GitLab explicitly recommends
  against. This is by far the heaviest option surveyed and mostly justified only if the
  cluster already wants full GitLab (issues, CI, etc.) for other reasons.

## Comparison

| Option | OIDC (Pocket ID) | Scanning (free) | Pull-through cache | Footprint | Notes |
|---|---|---|---|---|---|
| `registry:2` (current) | None | None | Yes (native) | Minimal | Baseline being replaced |
| Harbor | UI SSO + CLI-secret pattern | Trivy, built-in | Yes, first-class proxy-cache projects | Heavy (2-4 vCPU / 4-8 GB, Postgres+Redis) | Most complete; highest resource cost |
| Zot | No native OIDC (bearer/basic/LDAP only) | Trivy, built-in | Yes (`sync` `onDemand`) | Minimal (single binary) | Closest to current footprint; no OIDC without custom token-server glue |
| distribution/registry + auth proxy | No OIDC-capable proxy without custom code (docker_auth = Google/GitHub/LDAP only) | None built-in | Yes (native) | Light, but custom glue required | Most DIY, weakest OIDC story |
| GitLab Container Registry | GitLab UI SSO only; registry itself uses PAT/deploy/CI tokens | Free-tier CI-based Trivy scan | Only via "Dependency Proxy" (different feature, cache-only, no scan) | Very heavy (8 vCPU/16 GB, Gitaly, avoid NFS) | Only sensible if adopting all of GitLab |

## Recommendation

No surveyed registry gives literal "OIDC bearer-token pulls" — that is not how the OCI
distribution auth spec or any Docker/Podman/kubelet client works. Given that, and the
single-operator/free-first/cheap-with-justification constraints:

- **Harbor** is the best fit if the goal is SSO-gated human access (`docker login`/push via
  Pocket-ID-backed UI login + CLI secret) plus zero-effort free scanning and a drop-in
  replacement for the Docker Hub proxy-cache use case, and the operator is willing to
  accept a real jump in resource footprint (Postgres/Redis/Trivy/Core/Portal/Jobservice) for
  that convenience.
- **Zot** is the best fit if the priority is staying close to today's minimal, single-binary
  footprint while gaining free built-in Trivy scanning and keeping the existing
  pull-through-cache behavior — accepting that OIDC login isn't available without also
  building and maintaining a custom bearer-token auth server in front of it (not
  recommended to build for a single-operator homelab; the maintenance cost isn't
  justified by the benefit over Basic auth + Pocket-ID-gated Traefik `forwardAuth` for the
  read-only web UI only, with static creds/robot accounts for actual pulls).
- **distribution/registry + auth proxy** and **GitLab Container Registry** are not
  recommended: the former requires writing/maintaining custom OIDC glue with a smaller,
  slower-moving auth-proxy ecosystem for a worse result than Zot/Harbor; the latter is
  disproportionately heavy (8 vCPU/16 GB baseline, Gitaly, explicit anti-NFS guidance
  against this repo's NAS-backed storage model) unless GitLab is being adopted wholesale
  for reasons beyond the registry.

Suggested default: **Harbor**, if the extra resource cost is acceptable, for its built-in
Trivy scanning and native Docker-Hub proxy-cache project type that most directly replaces
`apps/registry.ts` today. **Zot** is the pragmatic fallback if resource footprint is the
overriding constraint, deferring OIDC-gated pulls (use Basic auth / robot accounts for
pulls, and gate the Zot web UI with Traefik `forwardAuth`/Pocket ID like other apps in this
repo for human browsing).

## Sources

- Harbor: [OIDC auth](https://goharbor.io/docs/latest/administration/configure-authentication/oidc-auth/), [proxy cache](https://goharbor.io/docs/latest/administration/configure-proxy-cache/), [vulnerability scanning](https://goharbor.io/docs/latest/administration/vulnerability-scanning/), [installation prerequisites](https://goharbor.io/docs/latest/install-config/installation-prereqs/)
- Zot: [zotregistry.dev home](https://zotregistry.dev/v2.1.9/), [authn-authz.adoc](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/kb/pages/authn-authz.adoc), [bearer-auth doc](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/admin-guide/partials/user-guide-chapters/security/security-bearer-auth.adoc), [sync-registries doc](https://raw.githubusercontent.com/project-zot/docs-zot/main/modules/admin-guide/partials/user-guide-chapters/server-configuration/sync-registries.adoc), [zot source (Trivy CVE scanning)](https://github.com/project-zot/zot/tree/main/pkg/extensions/search/cve/trivy)
- distribution/registry: [token auth spec](https://github.com/distribution/distribution/blob/main/docs/content/spec/auth/token.md)
- cesanta/docker_auth: [README](https://raw.githubusercontent.com/cesanta/docker_auth/master/README.md), [repo metadata](https://api.github.com/repos/cesanta/docker_auth)
- GitLab: [OIDC OmniAuth](https://docs.gitlab.com/administration/auth/oidc/), [container registry auth](https://docs.gitlab.com/user/packages/container_registry/authenticate_with_container_registry/), [container scanning](https://docs.gitlab.com/user/application_security/container_scanning/), [installation requirements](https://docs.gitlab.com/install/requirements/)
- Pocket ID: [repo](https://github.com/pocket-id/pocket-id), [pocket-id.org](https://pocket-id.org/docs/) — no client-credentials/API-key/service-account grant found in source tree
- Repo context: `apps/registry.ts`, `apps/pocket-id.ts`, `modifiers.ts` (`withOidcAuth`), `docs/forward-auth.md`
