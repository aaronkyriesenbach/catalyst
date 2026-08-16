# GitOps/CD tool and multi-cluster topology: ArgoCD, hub-and-spoke on the platform cluster

Status: accepted

Keep **ArgoCD** as the tool that reconciles apps onto the platform cluster and both workload
clusters, run as a single **hub-and-spoke** instance hosted on the platform cluster — registering
the External and Internal workload clusters as remote destinations via cluster `Secret`s — rather
than one ArgoCD install per cluster.

ArgoCD is the only GitOps/CD tool surveyed ([research](https://github.com/aaronkyriesenbach/catalyst/blob/master/docs/research/gitops-tool-research.md))
that runs arbitrary code — this repo's Bun-based TypeScript render step — natively inside its own
reconcile loop, via the Config Management Plugin (CMP) mechanism already in use (`main.ts`,
`utils.ts`). That's a structural requirement, not a preference: every app/cluster config in this
repo is authored as TypeScript, and no other surveyed tool can consume it without first rendering
it to plain YAML in a separate CI step. Its cluster-registration mechanism (`argocd cluster add` /
cluster `Secret`s, already partially wired via `buildApplication()`'s `destination.server`) is a
mature, push-based hub-and-spoke primitive that fits this repo's three-cluster shape directly,
reinforcing the platform cluster's charter (ADR 0002) as the home for every shared platform
service — including the thing that deploys everything else.

## Considered Options

- **FluxCD** — rejected: its own FAQ explicitly disallows arbitrary-binary Kustomize plugins for
  security/performance reasons, so it can only consume this repo's config via an external
  render-in-CI-then-apply-plain-YAML pipeline. It does have a genuine hub-and-spoke primitive
  (`Kustomization`/`HelmRelease.spec.kubeConfig`), but that would be adopted for no gain over
  ArgoCD's native support, at the cost of a new CI-failure blind spot (a broken render job leaves
  stale YAML reconciling silently) and a rendering/reconciling indirection ArgoCD's CMP avoids.
- **Rancher Fleet** — rejected for the same "no arbitrary-code hook" reason as Flux, despite having
  the best-in-class hub-and-spoke design of anything surveyed (agent-initiated pull, works behind
  NAT, no inbound reachability needed to spokes) — a genuinely strong topology story undermined by
  the same TypeScript-rendering gap.
- **Werf** — rejected as a category mismatch: a CI-triggered push tool with no in-cluster
  reconcile loop or drift detection, not a GitOps reconciler at all.
- **Kargo** — rejected as this decision's alternative because it isn't one: it's a
  promotion-orchestration layer designed to sit on top of ArgoCD, not replace it. Not adopted now
  (no environment-promotion workflow exists yet); revisit only if that becomes a real need.
- **One ArgoCD instance per cluster** — rejected: three independent instances add operational
  surface (three UIs/API endpoints, three sets of repo credentials to manage) for a single
  operator, with no isolation benefit ArgoCD's existing cluster-Secret model doesn't already give
  by other means (RBAC/AppProject scoping per destination cluster).

## Consequences

- `utils.ts`'s `buildApplication()` must grow real per-cluster `destination` targeting — today it
  hardcodes `destination.server: "https://kubernetes.default.svc"`, the in-cluster special case of
  the same mechanism.
- How newly-provisioned Omni clusters get **declaratively registered** with the hub ArgoCD
  instance, and what cross-cluster **authentication** mechanism is used (bearer token, exec
  plugin, TLS client cert), is an open follow-on question — not decided here.
- Whether per-app-per-cluster targeting is expressed as an explicit field on `AppConfig` or stamped
  via ArgoCD's `ApplicationSet` Cluster generator is also left open, folded into the same follow-on
  work rather than decided here.
- OpenBao's own one-time bootstrap (previously blocked on this decision landing, per ADR 0004) can
  now be scoped concretely: it's owned by whatever the platform cluster's ArgoCD instance renders
  for it, not a separate mechanism.
