# Research: GitOps/CD tool and multi-cluster topology

**Ticket**: [#38](https://github.com/aaronkyriesenbach/catalyst/issues/38) — part of the
["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Question**: what reconciles/deploys apps onto the platform cluster and the two workload
clusters (External, Internal) — stay on ArgoCD (today's inherited setup, built as an ArgoCD
CMP plugin per `main.ts`/`utils.ts`/`types.ts`) or move to something else — and is that one
controlling instance across all three clusters (hub-and-spoke) or one independent instance per
cluster?

**Hard constraint, non-negotiable**: all app/cluster config stays authored as **TypeScript** (a
Bun program producing Kubernetes manifests programmatically), never hand-authored YAML/Helm/
Kustomize. Any tool is in scope if it can consume TypeScript-rendered config either (a)
natively — the tool's own manifest-generation step runs arbitrary code as part of its reconcile
loop, the way ArgoCD's CMP does today; (b) via a plugin/extension mechanism equivalent to
ArgoCD's CMP; or (c) via a "render in CI, commit/push the resulting plain YAML, tool applies
plain YAML" pipeline, where the TypeScript rendering happens entirely outside the GitOps tool
and the tool itself only ever sees and applies plain rendered YAML. Option (c) is a real fork in
the design space, not a fallback — see the dedicated section below.

All claims below are cited to the owning project's own documentation/source, fetched directly.

---

## ArgoCD (status quo)

### Programmatic manifest generation: native plugin support (today's mechanism)

ArgoCD's own "native" config management tools are Helm, Jsonnet, and Kustomize; anything else
goes through a **Config Management Plugin (CMP)**. A CMP is installed as a sidecar container on
the `argocd-repo-server` Deployment, running `argocd-cmp-server` as its entrypoint. Its
`generate.command` is executed once per manifest-generation request "in the Application source
directory," and "standard output must be ONLY valid Kubernetes Objects in either YAML or JSON" —
i.e. the command can be literally anything, including a Bun script, as long as it prints
manifests to stdout and exits zero on success.
[Argo CD — Config Management Plugins](https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/config-management-plugins.md)

This is exactly this repo's current mechanism: `main.ts` running inside an `oven/bun`
CMP sidecar, reading `ARGOCD_ENV_APP_CONFIG`, dynamically importing `apps/<name>.ts`, and
printing YAML to stdout via `renderAppFromConfig`/`stringify` (see `main.ts`, `utils.ts`).
Argo CD explicitly documents this as a trust boundary: "Plugins are granted a level of trust in
the Argo CD system, so it is important to implement plugins securely. Argo CD administrators
should only install plugins from trusted sources." [same doc, above]

### Multi-cluster hub-and-spoke mechanism

Argo CD's multi-cluster story is a single controller registering N remote clusters as
credentials, not N controller installs. Clusters are registered via `argocd cluster add
CONTEXT`, which has flags for exec-based/AWS IAM/proxy auth
([`argocd cluster add` reference](https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/user-guide/commands/argocd_cluster_add.md)),
or declaratively as a `Secret` labeled `argocd.argoproj.io/secret-type: cluster` containing
`name`, `server`, and a `config` blob (bearer token, exec-provider, or TLS client cert/key) —
"Cluster credentials are stored in secrets same as repositories or repository credentials."
[Argo CD — Declarative Setup, "Clusters"](https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/declarative-setup.md)
Each `Application`'s `spec.destination.server` then simply points at whichever registered
cluster's API server URL it should deploy to — today this repo hardcodes it to
`https://kubernetes.default.svc` (`utils.ts`'s `buildApplication()`), i.e. the in-cluster
special case of the same mechanism.

Critically, the CMP sidecar lives on `argocd-repo-server`, a component of the single hub
install — **manifest rendering always happens on the hub**, regardless of which cluster an
`Application` targets. Only the already-rendered manifests get applied across the network to
the registered remote cluster's API server. This cleanly decouples "where the Bun script runs"
(always the hub) from "where resources land" (any registered cluster), which is the best
possible fit for hub-and-spoke plus a CMP.

A second, additive mechanism for the same topology is the `ApplicationSet` **Cluster
generator**: it reads the same cluster `Secret`s and auto-generates one `Application` per
registered cluster from a template (`generators: - clusters: {}`), useful for stamping the same
app across all three clusters without hand-writing an `Application` per cluster.
[Argo CD — ApplicationSet Cluster Generator](https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/applicationset/Generators-Cluster.md)

Argo CD also documents horizontal sharding of clusters across multiple
`argocd-application-controller` replicas ("If the controller is managing too many clusters and
uses too much memory then you can shard clusters across multiple") — headroom for 3 clusters
is a non-issue.
[Argo CD — High Availability](https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/high_availability.md)

### Self-hosted/free fit

Apache-2.0, per the GitHub repository metadata for `argoproj/argo-cd`. Already self-hosted and
running in this exact homelab today (this repo's own `main.ts`/`cluster/` are the primary
source for that fact) — zero new operational surface to learn.

### Migration cost if switching away

None, if staying — this is the do-nothing baseline. If switching to any other tool, the entire
CMP mechanism (`main.ts`'s `ARGOCD_ENV_APP_CONFIG` branch, `utils.ts`'s `buildApplication()`
which constructs the Argo CD `Application` CRD, and every app's discoverability contract) would
need replacing with whatever the new tool's equivalent hook is — see per-tool migration notes
below.

---

## FluxCD

### Programmatic manifest generation: none — explicitly disallowed by design

Flux has no equivalent of a CMP. Its own FAQ directly answers this: "Due to security and
performance reasons, Flux does not allow the execution of Kustomize plugins which shell-out to
arbitrary binaries insides the kustomize-controller container." The FAQ's own example of what
this rules out is exactly the shape of a CMP-like escape hatch (Kustomize's `helmCharts:` exec
plugin), and Flux's documented alternative is to swap the arbitrary-exec step for one of Flux's
own first-class Helm/OCI primitives (`HelmRelease`, `OCIRepository`) — not to run arbitrary code.
[Flux FAQ — "Should I be using Kustomize Helm chart plugin?"](https://raw.githubusercontent.com/fluxcd/website/main/content/en/flux/faq.md)

Flux's manifest sources are constrained to: plain YAML/Kustomize overlays from a `GitRepository`/
`OCIRepository` via `Kustomization`, or Helm charts via `HelmRelease` + `HelmRepository`/
`OCIRepository`. There is no "run this arbitrary command and take its stdout" primitive
anywhere in kustomize-controller or helm-controller's own spec.
[kustomize-controller `Kustomization` spec](https://raw.githubusercontent.com/fluxcd/kustomize-controller/main/docs/spec/v1/kustomizations.md),
[helm-controller `HelmRelease` spec](https://raw.githubusercontent.com/fluxcd/helm-controller/main/docs/spec/v2/helmreleases.md)

This means Flux categorically requires **option (c)** — render TypeScript to plain YAML
externally (e.g. in CI), commit/push it, and point a `Kustomization`/`OCIRepository` at the
rendered output. It cannot consume this repo's `apps/*.ts` model natively or via any documented
plugin path.

### Multi-cluster hub-and-spoke mechanism

Flux does have a genuine hub-and-spoke primitive: both `Kustomization.spec.kubeConfig` and
`HelmRelease.spec.kubeConfig` let a single Flux install (running in one "hub" cluster) apply,
health-check, prune, and delete resources on a **remote** cluster instead of the one Flux runs
in. Two auth modes are documented: `secretRef` (a static kubeconfig Secret, rotatable) and the
recommended `configMapRef`, which builds a kubeconfig dynamically via workload identity for
`aws`/`azure`/`gcp`/`generic` (OIDC-trust-based) providers — no long-lived static credential
needed. When combined with `spec.serviceAccountName`, Flux impersonates that ServiceAccount on
the *target* cluster rather than using its own in-cluster identity.
[kustomize-controller — "KubeConfig (Remote clusters)"](https://raw.githubusercontent.com/fluxcd/kustomize-controller/main/docs/spec/v1/kustomizations.md),
[helm-controller — "KubeConfig (Remote clusters)"](https://raw.githubusercontent.com/fluxcd/helm-controller/main/docs/spec/v2/helmreleases.md)
This mechanism is documented as composing with Cluster API (a kubeconfig Secret Cluster API
generates per provisioned cluster) — i.e. it's aimed at fleets of CAPI-managed clusters, a
similar shape to this repo's own Omni-provisioned clusters.

**However**, this is not Flux's primary documented multi-cluster pattern. Flux's own
"Ways of structuring your repositories" guide describes the default/recommended multi-cluster
setup as **one independent Flux install per cluster**, each bootstrapped against the same
monorepo at a different `clusters/<cluster-name>/` path (`flux bootstrap` run once per
cluster) — i.e. per-cluster installs, not a hub controlling remote clusters via `kubeConfig`.
The `kubeConfig` remote-cluster mechanism exists and works, but is presented as the
advanced/CAPI-oriented option, not the default topology.
[Flux — "Ways of structuring your repositories"](https://raw.githubusercontent.com/fluxcd/website/main/content/en/flux/guides/repository-structure.md)

### Self-hosted/free fit

Apache-2.0, per the GitHub repository metadata for `fluxcd/flux2`. CNCF-graduated toolkit of
small, independently-scaling controllers (source-controller, kustomize-controller,
helm-controller, notification-controller); no license cost.

### Migration cost from today's setup

High for the rendering side, low for the apply side. The entire CMP mechanism in `main.ts`
(the `ARGOCD_ENV_APP_CONFIG` branch and `renderAppFromConfig`) would have to move out of the
GitOps tool's reconcile loop entirely and into a CI step, since Flux cannot execute it in-line —
this is a structural rewrite of *how* rendering happens (CI-triggered, not reconcile-triggered),
not just a swap of one controller for another. `utils.ts`'s `buildApplication()` (which builds
an Argo CD `Application` CRD) would be replaced by generating a `Kustomization`/`OCIRepository`
pair per app instead — a much smaller, mechanical change once the CI-render pipeline exists.
`ARGOCD_ENV_APP_CONFIG`'s env-substitution footgun (`escapeArgoCmp`, `buildFileConfigMap` in
`utils.ts`) is Argo-CD-specific and would no longer be needed, since Flux never re-parses
rendered manifests for `$VAR` substitution the way Argo CD's CMP-env pipeline does.

---

## Rancher Fleet

### Programmatic manifest generation: none — raw/Kustomize/Helm `Bundle` sources only

Fleet's `Bundle` (the unit `GitRepo` compiles source into) supports exactly three content
shapes: plain YAML resources embedded as `spec.resources[].content`, a Kustomize directory
(`kustomize.dir` in `fleet.yaml`), or a Helm chart (`helm.chart`/`helm.repo`, downloaded by the
`fleet-cli` at bundle-creation time, not at deploy time). There is no documented arbitrary-code
generation hook analogous to a CMP anywhere in the `Bundle`/`GitRepo`/`fleet.yaml` reference
docs. [Fleet — "Create a Bundle Resource"](https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/bundle-add.md),
[Fleet — `fleet.yaml` reference](https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/ref-fleet-yaml.md)
Like Flux, Fleet requires **option (c)**: render TypeScript to plain YAML externally and either
commit it to the `GitRepo`'s path or hand-build a `Bundle` directly with the rendered content.

### Multi-cluster hub-and-spoke mechanism

Fleet is purpose-built for exactly this shape of problem: "Fleet has two primary components.
The Fleet controller and the cluster agents. These components work in a two-stage pull model.
The Fleet controller will pull from git and the cluster agents will pull from the Fleet
controller." Each downstream cluster runs one **cluster agent**, installed via Helm with a
cluster-registration-token credential; "the fleet manager does not initiate connections to
downstream clusters... managed clusters can run in private networks and behind NATs" — the
opposite network-direction assumption from Argo CD's model (there, the hub connects outbound to
each registered cluster's API server). [Fleet — Architecture](https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/architecture.md)
A second, less common registration mode ("manager-initiated") has the Fleet controller push an
agent to a downstream cluster using a stored kubeconfig Secret, closer to Argo CD's model, but
Fleet's docs describe this as the less-common path, primarily used when Rancher itself already
holds a kubeconfig for a cluster it provisioned.
[Fleet — "Register Downstream Clusters"](https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/cluster-registration.md)
Targeting which clusters/cluster-groups a `Bundle`/`GitRepo` deploys to is done via
label-selector `targets` blocks, matched against registered `Cluster`/`ClusterGroup` resources.

### Self-hosted/free fit

Apache-2.0, per the GitHub repository metadata for `rancher/fleet`. Runs standalone (not
Rancher-Manager-dependent) — a single Fleet controller install in any Kubernetes cluster, per
its own architecture doc above, which is directly usable as a from-scratch, non-Rancher
homelab component.

### Migration cost from today's setup

Similarly high on the rendering side as Flux, for the same reason: the CMP-based render step
must move out of the reconcile loop and into CI, since Fleet has no plugin/exec hook either.
`utils.ts`'s `buildApplication()` would be replaced by generating either raw-YAML `Bundle`
resources or, more idiomatically, `GitRepo` + `fleet.yaml` per-app target definitions.

---

## Werf

Werf is Apache-2.0
([`werf/werf` GitHub metadata](https://api.github.com/repos/werf/werf)) and its own README
describes it plainly: "werf is a CNCF Sandbox CLI tool to implement full-cycle CI/CD to
Kubernetes easily. werf integrates into your CI system." [`werf/werf` README](https://raw.githubusercontent.com/werf/werf/main/README.md)
Its own integration docs confirm the operative model: `werf ci-env` sets up CI-provided
credentials, and a pipeline stage runs `werf converge` directly inside the CI job (GitLab CI or
GitHub Actions), using a kubeconfig injected via `WERF_KUBECONFIG_BASE64` — i.e. werf is a
**push-based, CI-triggered deploy tool**, not a Kubernetes-resident controller with its own
reconcile loop. [Werf — "Integration with CI/CD systems"](https://raw.githubusercontent.com/werf/werf/main/docs/pages_en/usage/integration_with_ci_cd_systems.md)

This is a fundamentally different category from ArgoCD/Flux/Fleet: there is no drift detection,
no continuous reconciliation, and no in-cluster component watching Git — a `werf converge` only
runs when CI runs it. That rules it out as a **GitOps reconciler** for this decision regardless
of its manifest-rendering flexibility (which is Helm-chart-based, with its own template
extensions on top of Helm, and would still require rendering TypeScript to a chart externally).
Werf is not analyzed further as a contender; it solves CI/CD build+deploy pipelines, not the
"what continuously reconciles apps onto already-existing clusters" question this ticket asks.

---

## Kargo (Akuity)

Kargo is explicitly **not** a GitOps reconciler and not an alternative to Argo CD/Flux/Fleet —
it is a promotion-orchestration layer that sits on top of one. Its own FAQ states: "Continuous
promotion is the process of propagating desirable changes from the desired state of one stage
in an application's lifecycle to the desired state of the next... Kargo focuses on this
propagation; the actual deployment is performed by a GitOps agent such as Argo CD."
[Kargo FAQ](https://raw.githubusercontent.com/akuity/kargo/main/docs/docs/75-faqs.md)
Its architecture doc reinforces this dependency at the topology level: "Controllers are
designed to interact with the centralized Kargo control plane and, at most, one Argo CD control
plane. In enterprises with multiple Argo CD control planes, Kargo controllers exist in 1:1
proportion with those Argo CD instances."
[Kargo — Architecture and Topology](https://raw.githubusercontent.com/akuity/kargo/main/docs/docs/40-operator-guide/30-architecture/index.md)
Apache-2.0, per the GitHub repository metadata for `akuity/kargo`.

**Verdict**: orthogonal, not a contender for "which tool reconciles apps." Kargo answers "how do
changes get promoted between environments/stages," a problem this repo hasn't hit yet (no
staging/production environment split exists today). It only makes sense to layer on top of
whichever reconciler is chosen, and only if/when an environment-promotion workflow becomes a
real pain point — not a factor in the reconciler/topology decision itself.

---

## Ruled out without a deep dive

| Tool | One-line reason |
| --- | --- |
| **kro (Kube Resource Orchestrator)** | Declarative CRD-composition via `ResourceGraphDefinition` (CEL-expression templating over static YAML-like specs), not arbitrary-code rendering; and it has no Git-polling/reconcile-from-a-repo capability of its own — it would still need Argo CD/Flux/Fleet layered on top to actually be a GitOps tool, making it additive, not a replacement. [`kro` README](https://raw.githubusercontent.com/kro-run/kro/main/README.md) |
| **Pulumi Kubernetes Operator** | Genuinely supports real code (including TypeScript) via Pulumi's `Stack` CRD reconciled in-cluster, but it's built around Pulumi's own resource-engine/state-backend model (state file/service, `pulumi up` semantics, its own provider SDK) — adopting it means rewriting the entire `utils.ts` "build plain objects, print YAML" model into Pulumi's stateful resource-declaration model, a materially larger rewrite than adapting to any GitOps tool's plugin surface, for a tool primarily aimed at cloud-infra provisioning rather than plain Kubernetes-manifest rendering. [`pulumi-kubernetes-operator` README](https://raw.githubusercontent.com/pulumi/pulumi-kubernetes-operator/master/README.md) |
| **Crossplane (Compositions/Functions)** | Composition **Functions** do support genuinely custom code in a reconcile pipeline (Python/KCL/CUE/hand-written Go/gRPC functions — closer to a CMP than any other tool surveyed here), but Crossplane's own unit of management is a Composite Resource (XR)/claim, not a plain Kubernetes app manifest, and Crossplane itself has no built-in Git-polling — it would still need Argo CD/Flux/Fleet on top to sync from this repo, making it an addition on top of the reconciler decision, not a candidate for it. [Crossplane — Compositions](https://raw.githubusercontent.com/crossplane/docs/master/content/master/composition/compositions.md) |
| **Plain `kubectl apply` in CI** | No reconcile loop at all — drift between Git and the live cluster is invisible until the next CI run happens to touch that app; this is the exact "no GitOps tool" case the ticket's own framing (a Git-driven reconciler) is implicitly ruling out, distinct from option (c) below where a *real* reconciler still watches the rendered-YAML output continuously. |

---

## The "(c)" framing: decoupling rendering from the reconciler

Because ArgoCD's CMP is the *only* surveyed mechanism that runs arbitrary code (here, the Bun
render step) **inside** the GitOps tool's own reconcile loop, every other real contender (Flux,
Fleet) is only usable at all by moving the TypeScript-rendering step **outside** the GitOps tool
entirely: a CI job (e.g. GitHub Actions) runs the equivalent of `bun run render <app>` for every
app in `apps/`, and pushes the resulting plain YAML to a manifests branch, a separate repo, or an
OCI artifact. The GitOps tool then only ever sees and reconciles plain YAML — it never executes
TypeScript, never knows Bun exists, and (per the FAQ citation above) Flux couldn't be configured
to run it even if desired.

This materially changes the calculus:

- **For Flux and Fleet**, this isn't a workaround bolted on top of a limitation — it's the
  *only* way either tool can consume this repo's config at all, since neither has a documented
  plugin/exec hook. Once that pipeline exists, "which of Flux/Fleet/anything-else-that-applies-
  plain-YAML" becomes a question about topology mechanics, footprint, and operational fit —
  not about custom-code support, since the custom-code problem is fully solved upstream of the
  GitOps tool.
- **For Argo CD**, adopting this pattern would mean *giving up* today's tightest integration
  (CMP renders per-`Application`, on-demand, always in sync with the Application's revision) in
  exchange for... nothing distinctive, since Argo CD already supports arbitrary code natively.
  There's no reason to move Argo CD to option (c) unless the CMP's per-request rendering cost or
  trust model becomes a real operational problem (neither has been reported as one in this repo
  today).
- **The cost this pattern adds, regardless of tool**: a render step becomes a CI-time
  concern with its own failure mode (a CI run failing to render/push doesn't block a bad
  manifest from lingering — the GitOps tool will happily keep reconciling last-known-good
  rendered YAML if CI is broken, silently drifting from the source-of-truth TypeScript until the
  render pipeline is fixed). It also adds a second repository/branch/artifact as an
  indirection layer between "TypeScript config, as reviewed and merged" and "what's actually
  running," which the CMP model avoids by rendering directly from the same Git revision Argo CD
  already tracked.

---

## Comparison summary

| | ArgoCD | FluxCD | Rancher Fleet | Werf | Kargo |
| --- | --- | --- | --- | --- | --- |
| Runs TypeScript natively (CMP-equivalent) | **Yes** — CMP sidecar, arbitrary command | No — explicitly disallowed by FAQ | No — no plugin/exec hook documented | N/A (not a reconciler) | N/A (not a reconciler) |
| Requires option (c) (render-then-apply-plain-YAML) | No (today's status quo) | **Yes, only path** | **Yes, only path** | N/A | N/A |
| Hub-and-spoke, one instance → N clusters | **Yes** — `argocd cluster add` / cluster `Secret`, push model (hub connects out to each cluster's API server) | Yes, but secondary pattern — `spec.kubeConfig` per Kustomization/HelmRelease, push model; primary documented pattern is per-cluster installs | **Yes, and its primary design goal** — two-stage pull model, agent-initiated (works behind NAT, no inbound access to spokes needed) | N/A | N/A (rides on Argo CD's own topology, 1:1 per Argo CD control plane if sharded) |
| License | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 |
| Already running in this homelab | **Yes** | No | No | No | No |
| Migration cost from today | None | High (rendering moves to CI; Application→Kustomization swap is mechanical) | High (rendering moves to CI; Application→GitRepo/Bundle swap is mechanical) | N/A — different problem category | N/A — orthogonal addition, not a migration |

---

## Sources

- Argo CD — Config Management Plugins — <https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/config-management-plugins.md>
- Argo CD — Declarative Setup ("Clusters") — <https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/declarative-setup.md>
- Argo CD — `argocd cluster add` command reference — <https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/user-guide/commands/argocd_cluster_add.md>
- Argo CD — ApplicationSet Cluster Generator — <https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/applicationset/Generators-Cluster.md>
- Argo CD — High Availability — <https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/high_availability.md>
- Argo CD GitHub repository metadata (license) — <https://api.github.com/repos/argoproj/argo-cd>
- Flux FAQ — <https://raw.githubusercontent.com/fluxcd/website/main/content/en/flux/faq.md>
- Flux kustomize-controller — `Kustomization` API spec (`kubeConfig`) — <https://raw.githubusercontent.com/fluxcd/kustomize-controller/main/docs/spec/v1/kustomizations.md>
- Flux helm-controller — `HelmRelease` API spec (`kubeConfig`) — <https://raw.githubusercontent.com/fluxcd/helm-controller/main/docs/spec/v2/helmreleases.md>
- Flux — "Ways of structuring your repositories" — <https://raw.githubusercontent.com/fluxcd/website/main/content/en/flux/guides/repository-structure.md>
- Flux GitHub repository metadata (license) — <https://api.github.com/repos/fluxcd/flux2>
- Fleet — "Create a Bundle Resource" — <https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/bundle-add.md>
- Fleet — `fleet.yaml` reference — <https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/ref-fleet-yaml.md>
- Fleet — Architecture — <https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/architecture.md>
- Fleet — "Register Downstream Clusters" — <https://raw.githubusercontent.com/rancher/fleet-docs/main/docs/cluster-registration.md>
- Fleet GitHub repository metadata (license) — <https://api.github.com/repos/rancher/fleet>
- Werf README — <https://raw.githubusercontent.com/werf/werf/main/README.md>
- Werf — "Integration with CI/CD systems" — <https://raw.githubusercontent.com/werf/werf/main/docs/pages_en/usage/integration_with_ci_cd_systems.md>
- Werf GitHub repository metadata (license) — <https://api.github.com/repos/werf/werf>
- Kargo FAQ — <https://raw.githubusercontent.com/akuity/kargo/main/docs/docs/75-faqs.md>
- Kargo — Architecture and Topology — <https://raw.githubusercontent.com/akuity/kargo/main/docs/docs/40-operator-guide/30-architecture/index.md>
- Kargo GitHub repository metadata (license) — <https://api.github.com/repos/akuity/kargo>
- kro README — <https://raw.githubusercontent.com/kro-run/kro/main/README.md>
- Pulumi Kubernetes Operator README — <https://raw.githubusercontent.com/pulumi/pulumi-kubernetes-operator/master/README.md>
- Crossplane — Compositions (Functions) — <https://raw.githubusercontent.com/crossplane/docs/master/content/master/composition/compositions.md>
- catalyst repo (for current-state context): `main.ts`, `utils.ts`, `types.ts`
