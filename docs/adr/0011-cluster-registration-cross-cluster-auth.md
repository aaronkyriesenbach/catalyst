# Cluster registration and cross-cluster auth: Omni-issued bearer tokens via an idempotent, cron-triggered script

Status: accepted

Register the External and Internal workload clusters with the platform cluster's ArgoCD hub
(ADR 0007) using a per-cluster **bearer token** minted via Omni's `kubeconfig --service-account`
mechanism, targeting Omni's own shared Kubernetes-API-proxy (`server` plus a distinguishing
per-cluster query parameter, per Sidero's documented fix for ArgoCD's cluster-identity collision).
Both initial registration and ongoing token renewal are handled by a single idempotent script —
following this repo's existing `apply-cluster.ts`/`sync-external-certs.ts` idiom — deployed as a
Kubernetes `CronJob` on the platform cluster, polling every 5 minutes, rather than a human running
it by hand or a long-lived watch-based controller.

**Credential lifecycle**: TTL 30 days, renewed automatically by the same CronJob once remaining
validity drops below a 7-day buffer. This token has no individual revocation (only TTL expiry, or
rotating Omni's own JWT-signing key, which invalidates every cluster's tokens at once) — 30/7 bounds
its exposure window while tolerating roughly 23 days of continuous renewal failure (Omni, OpenBao,
or platform-cluster outages) before ArgoCD actually loses the ability to reconcile a spoke.

**Secrets sourcing**: the per-cluster bearer token is a static KV-v2 value in OpenBao, projected into
the ArgoCD cluster `Secret` via ESO's existing `ClusterSecretStore` (ADR 0004) — identical to every
other app-layer secret. The separate credential the CronJob itself needs to call Omni's API at all
(an Omni **service account** key, scoped to the `Operator` Omni role, not `Admin`) is bootstrap-layer
in character — it authenticates to infrastructure outside every Kubernetes cluster, the same
boundary ADR 0001 already draws for Proxmox/TrueNAS/Unifi — and lives in AWS Secrets Manager instead.
No better mechanism exists today: Omni supports only interactive user auth (4-8h, unsuitable for
automation) and static Service Account tokens; OIDC/workload-identity federation for machine clients
(the pattern AWS/GCP/Azure/Vault all support) is an open, unimplemented Omni feature request
([siderolabs/omni#2663](https://github.com/siderolabs/omni/issues/2663)) — a natural upgrade path if
Omni ships it, not a redesign.

**Per-app-per-cluster targeting**: the target cluster is inferred from directory placement (each
cluster gets its own top-level app directory) rather than an explicit `cluster` field on `AppConfig`
— consistent with this repo's per-app, statically-typed discovery model. Exact TypeScript mechanics
are left to implementation time, since the app-config layer's directory/module structure may be
redesigned wholesale as part of this rearchitecture rather than a minimal patch to today's `main.ts`.

## Considered Options

- **Manual one-time script per cluster** — rejected: works, but requires a human to remember the
  trigger event; the whole point of this ticket was closing that gap.
- **Watch-based controller** (Omni `ClusterStatus` watch API) — rejected: no material advantage over
  a 5-minute-poll CronJob at this cluster-creation cadence (a handful of times a year), for
  meaningfully more code (a watch/reconnect/backoff loop) and a standing process with its own
  liveness/failure-visibility burden. A CronJob's failed run is legible (`kubectl get jobs`) and
  self-heals on the next tick; a stalled watch connection can fail silently.
- **ArgoCD Agent** (`argocd-agent`, `argoproj-labs`) — rejected: genuinely eliminates the
  hub-held-credential problem (agent-initiated, mTLS, hub holds no spoke credential), but requires a
  near-full ArgoCD install per workload cluster (`argocd-application-controller` + `repo-server` +
  `redis` each) — reopening ADR 0007's already-rejected "one ArgoCD instance per cluster" tradeoff via
  a different path. The project's own docs self-describe as "not for the faint of heart," with its
  PKI tooling (`argocd-agentctl`) explicitly disclaimed as unsuitable for production use.
- **Bypassing Omni's proxy for a direct-to-cluster credential** — not possible. Confirmed against
  existing research (`docs/research/loadbalancer-talos-research.md`, #46): self-hosted Omni (#7)
  supersedes Talos's native VIP for the control-plane role, and Omni's own configuration reference
  forbids `cluster.controlPlane.endpoint`/`cluster.vip` on Omni-managed clusters. Every Omni-managed
  cluster's only reachable Kubernetes API endpoint is Omni's own WireGuard-tunneled proxy — this is
  inherited from #7's decision, not a property of the credential mechanism chosen here. Accepted
  consciously: ongoing ArgoCD reconciliation of both workload clusters depends on the Management
  host's uptime, same as any other use of these clusters' Kubernetes APIs.
- **Declaring the credential inside the Omni cluster template itself** — rejected: confirmed against
  Omni's authoritative cluster-template schema reference — no document kind or field exists for
  declaring service-account/kubeconfig issuance as part of cluster creation. Credential issuance is a
  deliberately separate, imperative concern from cluster shape in Omni's own design.
- **Break-glass kubeconfigs / a custom `execProviderConfig` BYOI ArgoCD image** — rejected per the
  original research (#41): break-glass sacrifices revocability and taints the cluster; a custom
  exec-plugin image requires build-pipeline infrastructure this repo doesn't have, for marginal
  benefit over the chosen static-token approach.

## Consequences

- `CONTEXT.md`'s **GitOps hub** entry is resolved: registration/auth is no longer "still open," and
  gains a note that the hub's ongoing reconciliation of both workload clusters depends on the
  Management host's uptime — inherited from #7, not introduced here.
- A new script + `CronJob` app needs building (exact placement per the directory-based targeting
  scheme): mints/stores/renews the per-cluster token and applies the resulting `ExternalSecret`.
- OpenBao gains a new write-capable policy/role (Kubernetes-auth-bound, scoped to a dedicated KV path)
  — the first OpenBao _write_ consumer in this repo; every other consumer only reads via ESO.
- AWS Secrets Manager gains one new bootstrap-layer secret: the `Operator`-scoped Omni service-account
  key used by the registration CronJob.
- `main.ts`'s app-discovery walk needs to change from a flat top-level scan to a per-cluster-directory
  scan, deriving `destination` from directory placement — exact shape deferred to implementation
  planning given the broader rearchitecture may restructure this file anyway.
- ArgoCD Agent and Omni's not-yet-shipped OIDC/workload-identity federation are both noted as
  legitimate future upgrade paths, not adopted now — tracked against the map's existing "Unified
  identity platform (human + machine)" fog entry.
- **Standing up Omni itself (TLS certs, encryption key, its bundled Dex OIDC provider configured with a
  static admin password, EULA acceptance) is legitimate OpenTofu/cloud-init territory** — all file
  generation and container-startup flags, no different in kind from any other bootstrap-layer service
  this repo already provisions declaratively. **The one genuinely irreducible manual step is the first
  login itself**: Dex is a real OIDC provider, and OIDC's login flow is a browser-redirect handshake by
  protocol design — there's no non-interactive equivalent for establishing the very first session, even
  with a static password configured, because nothing is authenticated yet for a CLI/API call to act as.
  Only from within that first session can `omnictl serviceaccount create` be invoked at all. So the
  manual footprint shrinks to: log into the Omni UI once (via the static password OpenTofu already
  configured), run `omnictl serviceaccount create --role Operator` once, and push the resulting key to
  AWS Secrets Manager once. This is implementation-time setup work, not a further design decision, and
  isn't tracked as its own wayfinder ticket for that reason.
- **Addendum**: [#52](https://github.com/aaronkyriesenbach/catalyst/issues/52) re-examined the Omni
  pick this ADR builds on — against Cluster API and other Talos-compatible alternatives, on management-
  plane merits alone — and re-confirmed it. This ADR's reasoning (including the Omni-proxy-dependency
  finding above) is unchanged.
