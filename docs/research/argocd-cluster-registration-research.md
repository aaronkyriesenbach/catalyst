# Research: Declarative cluster registration and cross-cluster auth for Omni + ArgoCD hub-and-spoke

**Ticket**: [#41](https://github.com/aaronkyriesenbach/catalyst/issues/41) — feeds into
[#42, "Decide cluster-registration and cross-cluster auth mechanism between the ArgoCD hub and
workload clusters"](https://github.com/aaronkyriesenbach/catalyst/issues/42) — part of the
["Homelab platform rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: ADR 0007 already decided ArgoCD as a single hub-and-spoke instance on the platform
cluster, registering the External and Internal workload clusters as remote destinations via
ArgoCD's standard cluster `Secret` mechanism (`argocd.argoproj.io/secret-type: cluster`,
`config.bearerToken` / `config.execProviderConfig` / `config.tlsClientConfig`) — see
[research #38](https://github.com/aaronkyriesenbach/catalyst/blob/master/docs/research/gitops-tool-research.md)
for that survey. ADR 0007 explicitly left open how a newly-Omni-provisioned cluster gets a
credential that fits one of those fields, how the registration `Secret` itself gets created
without a manual per-cluster ritual, and how that interacts with ADR 0004's OpenBao/ESO
secrets-management story. This document answers those three questions against primary sources:
Sidero's own Omni documentation (`docs.siderolabs.com`), the `siderolabs/omni` Go source
(fetched directly, commit `f2aeaa851a8e977eb104791a1efad8df38134789`, since the docs describe
symptoms of the credential's behavior but not its internal mechanism), and ArgoCD's own
declarative-setup docs. **It does not decide anything** — the call belongs to
[#42](https://github.com/aaronkyriesenbach/catalyst/issues/42).

---

## TL;DR

- **Yes, Omni exposes a long-lived, non-interactive Kubernetes credential**: `omnictl kubeconfig
  --service-account --cluster <name> --user <user> [--ttl <dur>] [--groups <groups>]` mints a
  kubeconfig with a **bearer token** (default TTL 8760h / 1 year, configurable, default group
  `system:masters`) — a direct fit for ArgoCD's cluster `Secret` `config.bearerToken` field.
  [Omni docs: *Create a Kubeconfig for a Kubernetes Service Account*, *omnictl CLI reference*]
- **That token is not a normal Kubernetes credential** — reading the `siderolabs/omni` source
  shows it is a JWT signed by **Omni's own** signing key, containing `cluster`, `cluster_uuid`,
  `sub`, and `groups` claims. It is only meaningful to **Omni's own Kubernetes API proxy**, which
  validates the JWT and forwards the request to the real cluster using Kubernetes
  Impersonation headers. It **cannot** be used to talk to a workload cluster's own
  control-plane endpoint directly — every Omni-managed cluster's kubeconfig, including this
  service-account one, points `server:` at one single, Omni-instance-wide "Kubernetes proxy"
  URL. Sidero's own FAQ confirms this causes ArgoCD to conflate distinct clusters registered
  through Omni unless mitigated. [source: `internal/backend/grpc/serviceaccount.go`,
  `internal/backend/k8sproxy/middleware.go`; docs: *FAQs*, *Omni Configuration*]
- **No native webhook/event-push mechanism exists** for "cluster finished provisioning."
  Omni does expose a COSI resource **watch** API (`ClusterStatus`, via `omnictl get ... --watch`
  or the Go client) that a custom script/controller could poll/watch — but nothing off-the-shelf
  wires that to ArgoCD cluster-`Secret` creation. Omni's own recommended pattern for cluster
  *creation* itself is CI/CD-triggered `omnictl cluster template sync` against a git-tracked
  template — declarative-as-in-version-controlled, not push-button-automatic.
  [docs: *Build with the Omni API*, *Terraform and Omni*]
- **No bootstrap-ordering chicken-and-egg problem for the actual ArgoCD credential**: by the time
  Omni provisions the External/Internal workload clusters, the platform cluster (and therefore
  ArgoCD, OpenBao, and ESO) already exists and is reconciling — so this credential is a normal
  app-layer secret and can be OpenBao/ESO-sourced like any other, as a static KV-v2 value (Omni
  has no ESO provider, so the token must still be *minted* out-of-band, but *storing and
  projecting* it is unaffected).

---

## 1. Does Omni expose a long-lived/rotatable credential suitable for an ArgoCD cluster `Secret`?

### 1.1 Two separate "service account" concepts — don't conflate them

Omni's docs describe two distinct credential types, both called "service accounts," that are easy
to conflate:

- **Omni service accounts** authenticate to **Omni's own API** (used by `omnictl`, the Go client,
  CI pipelines). Created with `omnictl serviceaccount create <name> [--ttl] [--role]`, default
  lifetime 1 year, inherits the creating user's role unless `--role`/`--use-user-role=false` is
  given. Requires `Admin` role to create. Output is an `OMNI_ENDPOINT` +
  `OMNI_SERVICE_ACCOUNT_KEY` pair. ["Create an Omni Service Account",
  https://docs.siderolabs.com/omni/omni-cluster-setup/create-an-omni-service-account:
  "Omni service accounts provide token-based authentication to Omni itself, not to the clusters it
  manages."]
- **Kubernetes service account kubeconfigs** authenticate to a **specific Omni-managed cluster's
  Kubernetes API** (what ArgoCD actually needs). Created with `omnictl kubeconfig
  --service-account --cluster <cluster> --user <username> <path>`. ["Create a Kubeconfig for a
  Kubernetes Service Account", https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-kubeconfig-for-a-service-account]

Omni's security-model doc states the rationale plainly: *"When using user authentication in
non-interactive workflows, Omni issues short-lived credentials... up to eight hours... Because
credentials may expire, user authentication is not recommended for CI/CD pipelines... Service
Accounts should be used instead... A service account is a long-lived, static authentication token
that can be used for the Omni API. Service account tokens can allow access to Omni, Talos, and
Kubernetes."* [https://docs.siderolabs.com/omni/security-and-authentication/security-model]

### 1.2 The Kubernetes-service-account kubeconfig: exact shape and knobs

From the `omnictl` CLI reference (https://docs.siderolabs.com/omni/reference/cli):

```
omnictl kubeconfig [local-path] [flags]
      --service-account              create a service account type kubeconfig instead of a OIDC-authenticated user type
      --ttl duration                 ttl for the service account token. only used when --service-account is set to true (default 8760h0m0s)
      --user string                  user to be used in the service account token (sub). required when --service-account is set to true
      --groups strings               group to be used in the service account token (groups). only used when --service-account is set to true (default [system:masters])
```

The resulting file is a standard `kubeconfig` with a `users[].user.token` bearer token and a
`clusters[].cluster.server` / `certificate-authority-data` pair — this maps directly onto
ArgoCD's cluster `Secret` schema (`config.bearerToken` + `config.tlsClientConfig.caData`), per
ArgoCD's own declarative-setup doc:

```yaml
config: |
  {
    "bearerToken": "<authentication token>",
    "tlsClientConfig": { "insecure": false, "caData": "<base64 encoded certificate>" }
  }
```
[https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/declarative-setup.md, "Clusters" section]

TTL is configurable to anything (a decade, if desired) — this satisfies "long-lived." **It is not
"auto-rotating"** in any documented sense: there is no `omnictl kubeconfig ... renew` subcommand
(unlike `omnictl serviceaccount renew`, which exists for the *Omni*-API service accounts, not
these). Refreshing before expiry means re-running the same command (optionally with `--force`)
and re-applying the resulting Secret — a job for whatever automation this repo builds for
question 2, not something Omni supplies natively.

### 1.3 What the token actually is (confirmed from source, since docs don't say)

Reading `siderolabs/omni` directly (`internal/backend/grpc/serviceaccount.go`,
`generateServiceAccountJWT` / `buildServiceAccountKubeconfig`, and
`internal/backend/k8sproxy/{jwt,middleware}.go`):

- The "bearer token" is a **JWT signed by Omni's own signing key**, with claims `iss:
  "omni-<account>-service-account-issuer"`, `sub` (the `--user` value), `groups` (the `--groups`
  value), `cluster`, and `cluster_uuid`.
  [https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/grpc/serviceaccount.go#L247-L269]
- The kubeconfig's `server:` field is **not** the cluster's own address — it is
  `s.cfg.Services.KubernetesProxy.URL()`, a single URL configured once for the whole Omni
  deployment, identical for every cluster it manages.
  [https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/grpc/serviceaccount.go#L271-L299]
  Confirmed independently in Omni's self-hosted configuration reference: *"KubernetesProxy
  contains Kubernetes proxy service configuration. It is the service responsible for proxying
  Kubernetes API requests to the clusters"* with one `AdvertisedURL` per Omni instance.
  [https://docs.siderolabs.com/omni/reference/omni-configuration, "services.kubernetesProxy"; example:
  https://docs.siderolabs.com/omni/self-hosted/omni-configuration-example, `kubernetesProxy.advertisedURL: https://omni-k8s.example.com`]
- On the receiving end, `k8sproxy.AuthorizeRequest` parses that JWT, validates its signature
  against Omni's own key, reads the `cluster`/`cluster_uuid` claims to pick the backend cluster,
  strips the original `Authorization` header, and replaces it with Kubernetes
  `Impersonate-User: <sub>` / `Impersonate-Group: <groups>` headers before forwarding.
  [https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/k8sproxy/middleware.go#L38-L128]

**Consequence**: this credential is only valid against Omni's own Kubernetes-API-proxy service
(default port 8095, one hostname per Omni instance) — it is *not* a portable, cluster-native
credential you could hand directly to a workload cluster's own kube-apiserver (e.g. its
kube-vip/HA control-plane VIP, which this repo already uses today and which the sibling
`docs/research/loadbalancer-talos-research.md` confirms Talos still needs per-cluster). Using it
means ArgoCD's cluster `Secret` must target Omni's proxy, not the workload cluster's own
endpoint — which quietly makes **the platform cluster's ongoing GitOps reconciliation of every
spoke depend on the Omni management host's availability**, not just on cluster creation as ADR
0002/CONTEXT.md's "management host" framing implies. This is a real, previously-undiscussed
consequence of ADR 0007 + the Omni cluster-lifecycle decision, worth flagging to #42 explicitly.

### 1.4 The documented FAQ collision, and why it happens

Sidero's own FAQ addresses this exact integration directly:

> *"Why do multiple Omni clusters appear as the same cluster in ArgoCD? ... ArgoCD identifies
> clusters primarily by their `server` URL, not by their cluster name or credentials. Since Omni
> exposes clusters through a shared kubeapi proxy endpoint, different clusters can appear
> identical from ArgoCD's perspective. This is a limitation of ArgoCD and is not specific to
> Omni. To ensure clusters are treated separately, each cluster must have a unique `server` value
> in ArgoCD. You can do this by: Appending a unique query parameter to the server URL...;
> Exposing each cluster through a distinct API endpoint (via DNS, reverse proxy, or ingress);
> Running a separate ArgoCD instance per cluster."*
> [https://docs.siderolabs.com/omni/troubleshooting/faqs, "Why do multiple Omni clusters appear as the same cluster in ArgoCD?"]

Given the source-level finding above (routing is determined entirely by the JWT's `cluster`
claim, never by the URL), the first mitigation — appending a distinguishing query parameter, e.g.
`https://omni-k8s.lab53.net:8095?cluster=external` — is functionally harmless to the proxy (which
only inspects the `Authorization` header) while giving ArgoCD's own cluster registry a unique map
key per spoke. The third option (a separate ArgoCD instance per cluster) is already rejected by
ADR 0007.

### 1.5 The alternative that bypasses Omni's proxy — and why it's the wrong tool

Omni does have a genuinely direct-to-cluster mechanism: **break-glass access**
(`omnictl kubeconfig --break-glass` / `omnictl talosconfig --break-glass`), which rewrites the
`server:` field to the machine's own address
(`internal/backend/runtime/kubernetes/kubernetes.go`, `BreakGlassKubeconfig`:
`c.Server = fmt.Sprintf("https://%s", net.JoinHostPort(endpoints[0], "6443"))`
[https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/runtime/kubernetes/kubernetes.go#L336-L353])
and grants a real, cluster-native credential. This is explicitly **not** a routine-automation
mechanism: Omni's own docs describe it as *"an emergency access mechanism... when the Omni
management plane is unavailable"* that must be opt-in via `--enable-break-glass-configs` for
self-hosted deployments, and warn that *"once break glass credentials are used, the cluster is
considered tainted... Omni cannot revoke or reliably track this access until CA rotation."*
[https://docs.siderolabs.com/omni/security-and-authentication/break-glass-emergency-access]
Security-model.md reinforces the contrast directly: *"service accounts can be revoked, whereas
break glass tokens cannot."* [https://docs.siderolabs.com/omni/security-and-authentication/security-model]
This rules break-glass out as the routine ArgoCD credential — it exists for exactly the opposite
situation (Omni is down and you need the cluster anyway), and using it permanently would
forfeit revocability and passively taint the cluster.

### 1.6 Rotation and revocation properties, honestly stated

- **TTL**: fully operator-configurable via `--ttl` (default 1 year). No forced short lifetime.
- **Auto-rotation**: not documented or found in source — none exists. Refreshing means
  re-minting and re-applying.
- **Individual revocation**: **Omni's docs and the CLI reference are silent** on any way to
  revoke one specific Kubernetes-service-account JWT before its TTL expires (unlike Omni service
  accounts, which have `omnictl serviceaccount destroy`, or join tokens, which have `omnictl
  jointoken revoke`). The only two paths that would invalidate it are TTL expiry, or rotating
  Omni's own JWT-signing key — which is an internal OIDC-storage mechanism
  (`internal/backend/oidc/internal/storage/keys/`), not exposed as an operator-facing command in
  the CLI reference, and would invalidate *every* such token across *every* cluster at once, not
  just one. Treat this credential as **effectively non-revocable in isolation** for the TTL you
  choose — a real argument for keeping the TTL shorter than "1 year" if this repo wants a
  meaningful revocation story, at the cost of needing the refresh automation from question 2 to
  run more often.
- **A theoretically stronger option, not adopted here**: ArgoCD's `execProviderConfig` supports
  running an arbitrary command to fetch fresh credentials per-request, but that command must
  ship inside the ArgoCD image itself
  ("[N]ote that if you specify a command to run under `execProviderConfig`, that command must be
  available in the Argo CD image. See BYOI (Build Your Own Image)."
  [https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/declarative-setup.md]),
  and the command's stdout must be a Kubernetes `ExecCredential` object, not a raw kubeconfig —
  so this would require a custom-built ArgoCD image bundling `omnictl` plus a small wrapper that
  reformats `omnictl kubeconfig --service-account` output into `ExecCredential` JSON. This would
  get closer to genuine short-lived/auto-refreshed credentials, at the cost of an image-build
  pipeline this repo doesn't have today. Worth revisiting only if the static-token approach's
  lack of revocation becomes a real operational concern.

**Answer to question 1**: Yes — `omnictl kubeconfig --service-account` is a real, documented,
long-lived (not auto-rotating) credential mechanism, directly compatible with ArgoCD's
`bearerToken` cluster-secret field. The catch, confirmed only by reading source (the docs
describe the symptom, not the cause), is that it routes through Omni's own shared
Kubernetes-API-proxy rather than the workload cluster's own endpoint, which (a) needs the
documented per-cluster `server` URL workaround to avoid ArgoCD conflating clusters, and (b) makes
ongoing spoke reconciliation dependent on the Omni management host's uptime — a real, if modest,
new coupling worth #42 knowing about explicitly.

---

## 2. Can cluster registration with ArgoCD itself be made declarative/automatic?

### 2.1 What Omni provides natively

- **Cluster creation** is already declarative in the "checked into git" sense via **cluster
  templates** — a multi-document YAML (`Cluster`, `ControlPlane`, `Workers`, `Machine`
  documents) applied with `omnictl cluster template sync -f cluster.yaml`. Omni's own docs
  describe this as the recommended CI/CD pattern: *"For ongoing cluster and machine lifecycle
  management, GitOps and CI/CD workflows remain the recommended approach. In these workflows,
  desired configuration is stored in version control, reviewed through pull requests, and applied
  to Omni using automation such as `omnictl cluster template sync`. Omni then assumes
  responsibility for continuously reconciling the submitted configuration."*
  [https://docs.siderolabs.com/omni/cluster-management/terraform-and-omni, "GitOps and CI/CD workflows"]
  This is declarative-as-in-version-controlled-desired-state, but **not** push-button-automatic —
  a human or a CI job still has to run the apply step.
- An **official Terraform/OpenTofu provider** exists (`siderolabs/omni`) but is explicitly
  "early, alpha-stage," with the docs recommending cluster templates remain the primary
  cluster-lifecycle interface and Terraform be reserved for the infrastructure Omni depends on,
  not as a replacement for Omni's own reconciliation model.
  [https://docs.siderolabs.com/omni/cluster-management/terraform-and-omni] This repo's bootstrap
  layer already uses OpenTofu (ADR 0001), so this is a real future integration point, but not
  one mature enough to build the cluster-registration answer on top of today.
- **Manifest sync**, a cluster-template feature, deploys raw Kubernetes manifests into the
  cluster being templated once its API is healthy, in `one-time` or `full` mode. Its own docs
  call out exactly this repo's situation: *"This is useful for bootstrapping workloads like Argo
  CD... Use [one-time mode] for tools that manage themselves after bootstrapping, like Argo CD."*
  [https://docs.siderolabs.com/omni/cluster-management/sync-kubernetes-manifests] This is
  Omni-endorsed and directly on-topic, but it only pushes manifests **into the cluster the
  template describes** — it cannot write a `Secret` into a *different* cluster (the platform
  cluster's `argocd` namespace) as a side effect of the External/Internal workload cluster's own
  template syncing. It doesn't solve registration; it solves a different, adjacent problem
  (bootstrapping something *onto* a freshly-created cluster).
- **No webhook or event-push system is documented.** A full-text pass over Omni's own
  documentation index (`docs.siderolabs.com/llms.txt`) turns up no "webhook," "event sink," or
  push-notification mechanism for cluster lifecycle transitions (the one Talos-side
  `EventSinkConfig`/`KmsgLogConfig` hits in that index are unrelated log-shipping config
  documents, not an Omni-side hook). This is a case where **Omni's documentation is silent**
  rather than merely non-obvious — there is no evidence of this feature existing, not just a gap
  in what was found.
- **A COSI resource watch API does exist** and is the closest real building block: *"Beyond
  managing clusters, Omni resources support watch operations, which allow clients to receive
  real-time updates when resource state changes. This is commonly used for observability
  integrations, automation pipelines, and systems that need to react to provisioning or cluster
  health events."* [https://docs.siderolabs.com/omni/reference/build-with-the-omni-api] — listing
  `ClusterStatus` explicitly as a status resource for this purpose. The CLI exposes the same
  primitive: `omnictl get clustermachinestatus <id> -o yaml --watch`
  [https://docs.siderolabs.com/omni/reference/manage-omni-resources-with-omnictl, "Watch a
  resource"].

### 2.2 What this means for a purpose-built registration mechanism

Nothing off-the-shelf connects "Omni finished provisioning a cluster" to "an ArgoCD cluster
`Secret` now exists." The building blocks for a **custom** small reconciler are real
(watch `ClusterStatus`/`ClusterMachineStatus` for a healthy cluster with no matching registration
`Secret` yet, mint its service-account kubeconfig, render and apply the ArgoCD `Secret`), but this
would be new code this repo would own and operate — a small Go program using the Omni Go client
(https://pkg.go.dev/github.com/siderolabs/omni/client/pkg/client), or a shell/CronJob script
wrapping `omnictl`, run as a Kubernetes `CronJob` on the platform cluster. No search of Omni's
docs or source turned up an existing project that does this specific Omni→ArgoCD handoff.

Weighed against this repo's standing preferences (single operator, incremental/parallel-build
cutover, and — per this ticket's framing — a cluster count that grows slowly over time rather
than autoscaling):

| | Manual one-time step per cluster | Custom watch-based controller/CronJob |
|---|---|---|
| Effort to build | ~Zero — a documented `omnictl` + `kubectl apply` recipe | A new component: watch loop or poll schedule, error handling, idempotent secret rendering, its own RBAC/credentials |
| Effort to operate | One command, run rarely (2 clusters today, occasional growth) | A long-running or scheduled workload to monitor, patch, and secure |
| Failure mode | Forgetting the step — visible immediately (new cluster has no Applications) | Silent drift if the watcher itself breaks; a new thing that can be "down" |
| Fits "incremental, reversible" cutover philosophy | Yes — trivially reversible, no new standing infrastructure | Adds a standing dependency before it's proven necessary |
| Scales to "many clusters, frequent churn" | No — becomes toil | Yes — this is where it pays for itself |

**Given today's scale** (platform + 2 workload clusters, expected to grow occasionally, not
churn), a manual-but-scripted step is proportionate: not a raw `omnictl`/`kubectl` ritual typed
from memory, but a small script checked into this repo (in the spirit of the existing
`scripts/apply-cluster.ts` / `scripts/sync-external-certs.ts` idiom) that takes a cluster name,
runs `omnictl kubeconfig --service-account`, renders the ArgoCD cluster `Secret` YAML (with the
FAQ's query-param uniqueness fix applied), and applies it to the platform cluster. This keeps the
actual trigger ("a new cluster exists and needs registering") a deliberate, visible, single-command
operator action rather than invisible automation — while removing the error-prone parts (recalling
the exact `omnictl`/Secret-shape incantations) into version-controlled code. If cluster count or
churn grows enough that this becomes routine toil, the watch-API-based controller described above
is a well-defined, buildable escalation path — not a redesign, since the underlying primitives
(Omni service account for auth, `Kubeconfig(WithServiceAccount(...))` from the Go client, the same
Secret shape) are identical either way.

**Answer to question 2**: No built-in declarative/automatic registration exists; Omni provides
the raw materials (a watch API, a scriptable CLI/Go client) to build one, but nothing
off-the-shelf does it today. Recommend a small, version-controlled script invoked manually per new
cluster now, with the watch-based controller as a documented, low-regret escalation path if
cluster count or churn grows.

---

## 3. Interaction with OpenBao/ESO (ADR 0004) and bootstrap ordering

### 3.1 There are actually two credentials here, not one

- **The Omni-API credential** used to *mint* the per-cluster kubeconfig (either an interactive
  Omni user session, or, for automation, an **Omni service account** —
  `omnictl serviceaccount create`, giving an `OMNI_SERVICE_ACCOUNT_KEY`). This authenticates to
  Omni itself, which — per CONTEXT.md's own "Management host" definition — is **infrastructure
  outside every cluster it manages**, architecturally adjacent to Proxmox/TrueNAS/Unifi rather
  than to any in-cluster app. It is needed *before* you can even ask Omni for a cluster's
  kubeconfig, so whatever runs the registration step (a human operator, or the script from
  question 2) needs this credential available to it independent of any Kubernetes cluster's own
  state.
- **The per-cluster Kubernetes bearer token** (the actual payload of the ArgoCD cluster `Secret`),
  minted using the credential above, scoped to one workload cluster's Kubernetes API via Omni's
  proxy.

### 3.2 Is there a chicken-and-egg problem for the ArgoCD credential itself?

**No**, for a straightforward ordering reason specific to this repo's already-decided
architecture: the platform cluster is provisioned first and hosts every shared platform
service — ArgoCD (the hub), OpenBao, and ESO — per ADR 0002 and ADR 0007. The External and
Internal workload clusters are provisioned by Omni *after* the platform cluster already exists
and is reconciling. By the time either workload cluster needs a registration `Secret`, OpenBao
and ESO are already up and already the established mechanism for every other app-layer secret —
there is nothing structurally different about this one that forces it to exist before OpenBao/ESO
are usable.

It's also worth noting explicitly: the hub's reconciliation of **itself** (the in-cluster
`https://kubernetes.default.svc` destination, already hardcoded in `utils.ts`'s
`buildApplication()`) needs **no external credential at all** — it uses ArgoCD's own in-cluster
`ServiceAccount`. The only credentials this ticket's mechanism produces are for the two workload
clusters, both created strictly after the platform cluster (and therefore after OpenBao/ESO)
exist. This mirrors ADR 0004's own resolution of the *general* "OpenBao's own bootstrap" question
via ADR 0007's consequences section: *"OpenBao's own one-time bootstrap... can now be scoped
concretely: it's owned by whatever the platform cluster's ArgoCD instance renders for it"* — i.e.
the platform cluster (and its OpenBao/ESO/ArgoCD trio) is the one thing in this whole picture that
*does* need a bootstrap answer outside this ticket's scope, and that's already been deferred
elsewhere, not reopened here.

### 3.3 Should it be OpenBao/ESO-sourced?

**Yes, for the credential itself** — consistent with ADR 0004's existing app-layer secrets
story. Concretely, this is a **static KV-v2** secret in OpenBao (per ADR 0004's own distinction
between dynamic-secrets-engine-managed credentials and "static KV-v2 + generator-issued values"),
not a dynamically-generated one: Omni is not a Vault/OpenBao secrets-engine backend and has no ESO
provider, so neither OpenBao nor ESO can *mint* this token themselves — the actual
`omnictl kubeconfig --service-account` invocation (or the question-2 controller's equivalent) must
still happen out-of-band and write the resulting token into OpenBao. Once it's in OpenBao, though,
the *consumption* side is exactly the existing pattern: an `ExternalSecret` (via ESO's OpenBao
`ClusterSecretStore`) renders it into the `argocd.argoproj.io/secret-type: cluster`-labeled
`Secret` in the platform cluster's ArgoCD namespace, identically to how any other app-layer secret
is projected today. This keeps the credential subject to OpenBao's access controls and audit
trail, and out of git, rather than being a one-off `kubectl apply`d plaintext Secret that bypasses
the secrets-management story this repo just built.

The **Omni service-account key** used to mint the token, by contrast, is arguably better modeled
as **bootstrap-layer**, alongside Proxmox/TrueNAS/Unifi credentials in AWS Secrets Manager per ADR
0001 — it authenticates to infrastructure that lives outside every Kubernetes cluster (the
"management host"), exactly the boundary ADR 0001 already draws, and it's needed by
whatever process runs the registration script, which may itself need to run before assuming
OpenBao is reachable (e.g., if run from an operator's workstation, or a CI runner outside the
platform cluster). This is a nuance ADR 0004 doesn't need to be reopened over — it doesn't change
ADR 0004's boundary, it just means the *registration script's own* credential should follow the
existing bootstrap-layer precedent, while the *token it produces* follows the existing app-layer
one.

**Answer to question 3**: No chicken-and-egg problem exists for the ArgoCD-facing credential —
OpenBao and ESO are already running by the time either workload cluster is created, so it should
be OpenBao/ESO-sourced (static KV-v2) like any other app-layer secret. The separate credential
needed to *mint* it (an Omni service account key) is bootstrap-layer in character and fits ADR
0001's existing AWS-Secrets-Manager precedent instead, without requiring any change to ADR 0004's
boundary.

---

## Verdict / Recommendation for #42

1. **Credential mechanism**: Use `omnictl kubeconfig --service-account --cluster <name> --user
   argocd --groups system:masters --ttl <chosen-duration>` (Go-client equivalent for automation:
   `client.Management().WithCluster(name).Kubeconfig(ctx, management.WithServiceAccount(ttl,
   "argocd"))`) to mint the bearer token, and populate ArgoCD's cluster `Secret` with
   `config.bearerToken` set to that token and `server` set to Omni's Kubernetes-proxy URL **plus
   a distinguishing query parameter per cluster** (Sidero's own documented fix for the
   shared-proxy-URL collision). Explicitly reject break-glass kubeconfigs for this purpose (they
   sacrifice revocability and taint the cluster) and reject a custom `execProviderConfig`/BYOI
   approach for now (real image-build overhead this repo doesn't have infrastructure for yet,
   though it's a legitimate future upgrade if the static token's lack of individual revocability
   becomes a concern). Flag explicitly to #42 that this choice makes ongoing spoke reconciliation
   depend on the Omni management host's availability, not just cluster creation — a new coupling
   worth accepting consciously rather than discovering later.
2. **Registration automation**: No good off-the-shelf automatic mechanism exists. Build a small,
   version-controlled script (idiomatically similar to `scripts/apply-cluster.ts`) that an
   operator runs once per new cluster; don't build a watch-based controller yet. Revisit that
   escalation only if cluster count or churn grows enough to make the manual step real toil — the
   underlying primitives (Omni service account, the Go client's `Kubeconfig` call, the same
   Secret shape) carry over unchanged, so this isn't a decision that forecloses automating later.
3. **OpenBao/ESO ordering**: Yes — source the ArgoCD-facing bearer token from OpenBao via ESO
   (static KV-v2), same as other app-layer secrets. No bootstrap-ordering problem exists for it,
   because the platform cluster (and therefore OpenBao/ESO) is created and reconciling before
   either workload cluster is provisioned. Keep the separate Omni service-account key that mints
   the token in AWS Secrets Manager, alongside Proxmox/TrueNAS/Unifi credentials, per ADR 0001's
   existing bootstrap-layer boundary — this is a natural extension of that ADR's existing
   reasoning, not a new exception to it.

---

## Sources

- Omni — Create a Kubeconfig for a Kubernetes Service Account —
  https://docs.siderolabs.com/omni/omni-cluster-setup/create-a-kubeconfig-for-a-service-account
- Omni — Create an Omni Service Account —
  https://docs.siderolabs.com/omni/omni-cluster-setup/create-an-omni-service-account
- Omni — Use Kubectl With Omni —
  https://docs.siderolabs.com/omni/getting-started/use-kubectl-with-omni
- Omni — omnictl CLI reference — https://docs.siderolabs.com/omni/reference/cli
- Omni — Build with the Omni API —
  https://docs.siderolabs.com/omni/reference/build-with-the-omni-api
- Omni — Manage Omni Resources with omnictl —
  https://docs.siderolabs.com/omni/reference/manage-omni-resources-with-omnictl
- Omni — Authentication and Authorization —
  https://docs.siderolabs.com/omni/security-and-authentication/authentication-and-authorization
- Omni — Omni, Talos, and Kubernetes Security (security model) —
  https://docs.siderolabs.com/omni/security-and-authentication/security-model
- Omni — Break Glass Emergency Access —
  https://docs.siderolabs.com/omni/security-and-authentication/break-glass-emergency-access
- Omni — CA Rotation — https://docs.siderolabs.com/omni/cluster-management/ca-rotation
- Omni — Terraform and Omni —
  https://docs.siderolabs.com/omni/cluster-management/terraform-and-omni
- Omni — Sync Kubernetes Manifests —
  https://docs.siderolabs.com/omni/cluster-management/sync-kubernetes-manifests
- Omni — Create a Cluster — https://docs.siderolabs.com/omni/getting-started/create-a-cluster
- Omni — Omni Configuration (reference) —
  https://docs.siderolabs.com/omni/reference/omni-configuration
- Omni — Omni Configuration Examples —
  https://docs.siderolabs.com/omni/self-hosted/omni-configuration-example
- Omni — Omni Firewall and Egress Requirements —
  https://docs.siderolabs.com/omni/omni-cluster-setup/omni-firewall-egress-requirement
- Omni — What is Omni? — https://docs.siderolabs.com/omni/overview/what-is-omni
- Omni — FAQs (ArgoCD/shared-kubeapi-proxy question) —
  https://docs.siderolabs.com/omni/troubleshooting/faqs
- Omni Go client library — https://pkg.go.dev/github.com/siderolabs/omni/client/pkg/client
- `siderolabs/omni` source, commit `f2aeaa851a8e977eb104791a1efad8df38134789`:
  - `internal/backend/grpc/serviceaccount.go` —
    https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/grpc/serviceaccount.go
  - `internal/backend/k8sproxy/middleware.go` —
    https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/k8sproxy/middleware.go
  - `internal/backend/k8sproxy/jwt.go` —
    https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/k8sproxy/jwt.go
  - `internal/backend/runtime/kubernetes/kubernetes.go` —
    https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/internal/backend/runtime/kubernetes/kubernetes.go
  - `client/pkg/omnictl/kubeconfig.go` —
    https://github.com/siderolabs/omni/blob/f2aeaa851a8e977eb104791a1efad8df38134789/client/pkg/omnictl/kubeconfig.go
- ArgoCD — Declarative Setup (Clusters section) —
  https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/declarative-setup.md
- ArgoCD — ApplicationSet Cluster Generator —
  https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/operator-manual/applicationset/Generators-Cluster.md
- catalyst repo (context, not this ticket's subject): `docs/adr/0001-bootstrap-layer-iac-tooling.md`,
  `docs/adr/0002-dedicated-platform-cluster.md`, `docs/adr/0003-partition-workload-clusters-by-trust-boundary.md`,
  `docs/adr/0004-secrets-management-openbao.md`, `docs/adr/0007-gitops-argocd-hub-and-spoke.md`,
  `CONTEXT.md`, `docs/research/gitops-tool-research.md` (branch `research/gitops-tool-research`),
  `docs/research/loadbalancer-talos-research.md` (branch `research/loadbalancer-talos-research`),
  `scripts/apply-cluster.ts`
- GitHub issues: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1),
  [#41](https://github.com/aaronkyriesenbach/catalyst/issues/41),
  [#42](https://github.com/aaronkyriesenbach/catalyst/issues/42)
