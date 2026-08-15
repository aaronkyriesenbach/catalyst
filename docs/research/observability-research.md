# Research: observability stack options

Ticket: [#29](https://github.com/aaronkyriesenbach/catalyst/issues/29) (part of the
"Homelab platform rearchitecture" wayfinder map, [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

Scope: this is a **greenfield** survey — nothing is deployed today (no
Prometheus/Grafana/Loki/Alertmanager). Constraints: single operator; 2 k3s
nodes today (control-plane+etcd node also runs workloads), more nodes planned;
free-tier-first, cheap-with-justification is fine; the observability stack's
own resource footprint matters because it competes with workload apps for
capacity on small nodes; alerting should reach a phone (push) and/or email.

All claims below are cited to the owning project's own docs/repo, not
third-party write-ups.

## TL;DR recommendation

- **Metrics: VictoriaMetrics single-node + `victoria-metrics-k8s-stack` Helm
  chart** (VictoriaMetrics Operator + VMAgent + VMSingle + VMAlert +
  Grafana + kube-state-metrics + node-exporter), not `kube-prometheus-stack`.
  Same dashboards/alerting ecosystem, same Prometheus-Operator-CRD experience,
  but the storage engine itself is documented by its own maintainers as using
  up to 7x less RAM than Prometheus for the same series
  ([victoriametrics/single-server-victoriametrics §Prominent features](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#prominent-features)),
  which is the single biggest cost lever on a small node. It's also a drop-in
  Prometheus remote-write/query-API target, so this is not a dead-end choice.
- **Logs: VictoriaLogs single-node**, not Loki. VictoriaLogs ships as one
  zero-config binary with no mandatory external dependency, whereas Loki's own
  Helm chart's monolithic install path now defaults to requiring S3-compatible
  object storage (MinIO or cloud) even for a single replica
  ([Loki Helm: Install the monolithic Helm chart §Single Replica](https://grafana.com/docs/loki/latest/setup/install/helm/install-monolithic/)).
  VictoriaLogs' own docs claim up to 30x less RAM and 15x less disk than "other
  solutions such as ... Grafana Loki"
  ([VictoriaLogs README §Features](https://docs.victoriametrics.com/victorialogs/#features)) — a
  vendor claim, flagged as such below, but directionally consistent with the
  architecture difference (filesystem-native vs. object-store-native).
- **Alerting channel: this is effectively already decided in-repo.** `docs/notifications.md`
  in this repo already designs Apprise (gateway) → Pushover (push) + AWS SES
  (email), explicitly built so that "when a metrics stack lands later,
  Alertmanager plugs into the same gateway with no rework." Alertmanager's own
  generic `webhook_config` receiver supports a custom Go-template `payload:`
  field that can be shaped to match whatever JSON Apprise's `/notify/{key}`
  endpoint expects, so no translator service is needed
  ([Prometheus Alerting configuration docs §`<webhook_config>`](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config)).
  VMAlert (VictoriaMetrics' alert evaluator) is Alertmanager-notifier-compatible
  by design, so this plan carries over unchanged if VictoriaMetrics is chosen
  over Prometheus (see below).

## Metrics: kube-prometheus-stack vs. the VictoriaMetrics stack

### kube-prometheus-stack (Prometheus Operator + Grafana)

- The chart installs the Prometheus Operator plus, by default, three
  dependency charts: `kube-state-metrics`, `prometheus-node-exporter`, and
  `grafana` ([kube-prometheus-stack README §Dependencies](https://github.com/prometheus-community/helm-charts/blob/main/charts/kube-prometheus-stack/README.md#dependencies)).
  Each dependency is independently toggleable, but the "batteries included"
  path pulls in all of them plus curated dashboards/rules sourced from the
  `kube-prometheus` project
  ([README §Usage / Grafana Dashboards](https://github.com/prometheus-community/helm-charts/blob/main/charts/kube-prometheus-stack/README.md#grafana-dashboards)).
- Prometheus's own storage docs state it stores **an average of only 1-2
  bytes per sample** on disk, and that capacity should be planned via
  `retention_time_seconds * ingested_samples_per_second * bytes_per_sample`
  ([Prometheus Storage docs §Operational aspects](https://prometheus.io/docs/prometheus/latest/storage/#operational-aspects)).
  That formula only covers disk; there is no official Prometheus RAM sizing
  formula for small clusters in the primary docs — Prometheus recommends
  empirical testing for compute sizing, same caveat VictoriaMetrics gives (see
  below).
- HA is opt-in and doubles cost: running `replicas: 2` Prometheus pods with
  hard pod anti-affinity is the documented HA pattern, and note this is a
  second full copy of ingestion + storage, not a lightweight failover
  ([kube-prometheus-stack README §Prometheus High Availability (HA)](https://github.com/prometheus-community/helm-charts/blob/main/charts/kube-prometheus-stack/README.md#prometheus-high-availability-ha)).
  For a single-operator homelab on 2 nodes, this is avoidable — but it means
  Prometheus alone (1 replica) plus kube-state-metrics plus node-exporter
  DaemonSet plus Grafana is the realistic minimum footprint, and none of these
  components share a process.
- Local TSDB storage is **not clustered or replicated** by design — it's meant
  to be treated like any single-node database and is not itself the HA
  mechanism ([Prometheus Storage docs §Local storage](https://prometheus.io/docs/prometheus/latest/storage/#local-storage)).

### VictoriaMetrics stack (`victoria-metrics-k8s-stack` Helm chart)

- This is VictoriaMetrics' own equivalent of kube-prometheus-stack: "an
  all-in-one solution to start monitoring and logging in a Kubernetes
  cluster," installing the same dependency set — Grafana, node-exporter,
  kube-state-metrics — plus the **VictoriaMetrics Operator**, and creating
  `VMSingle`/`VMCluster`, `VMAgent`, `VMAlert` custom resources instead of
  Prometheus Operator's native CRDs. By default the operator auto-converts any
  existing Prometheus-Operator objects (`ServiceMonitor`, `PrometheusRule`,
  etc.) into VictoriaMetrics-native ones, so migrating dashboards/alert rules
  written for kube-prometheus-stack is a supported path, not a rewrite
  ([victoria-metrics-k8s-stack README §Overview](https://docs.victoriametrics.com/helm/victoria-metrics-k8s-stack/#overview)).
- Logs can be added to the *same* chart/operator later via `VLSingle`/`VLCluster`
  ([victoria-metrics-k8s-stack README §Logs storage and collection](https://docs.victoriametrics.com/helm/victoria-metrics-k8s-stack/#logs-storage-and-collection)) —
  useful if metrics land first and logs get added as the cluster grows,
  without adopting a second operator/CRD family.
- Resource-efficiency claims, from VictoriaMetrics' own single-node docs:
  "uses 10x less RAM than InfluxDB" and "up to 7x less RAM than Prometheus,
  Thanos or Cortex... when dealing with millions of unique time series," plus
  "up to 7x less storage space... compared to Prometheus, Thanos or Cortex"
  ([victoriametrics/single-server-victoriametrics §Prominent features](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#prominent-features)).
  These are vendor-authored comparative numbers (they link to the vendor's own
  benchmark blog posts) rather than third-party audits, so treat the specific
  multipliers skeptically — but the underlying architectural reason (a single
  static Go binary, no external dependencies, explicit low-cardinality/high-compression
  design goals) is independently verifiable in the same doc and is consistent
  with why VictoriaMetrics is commonly chosen for small/edge deployments.
  Compute sizing still isn't given a formula either — VictoriaMetrics' own
  sizing guide says the same thing Prometheus effectively says: "it is hard to
  predict... the much better approach is to run tests"
  ([Understand Your Setup Size §Compute resources](https://docs.victoriametrics.com/guides/understand-your-setup-size/#compute-resources)).
- Disk sizing has an explicit formula and rule of thumb: average ~1 byte/sample
  after compression, and keep at least 20% of disk free for merges
  ([Understand Your Setup Size §Retention Period/Disk Space](https://docs.victoriametrics.com/guides/understand-your-setup-size/#retention-perioddisk-space)) —
  the same order of magnitude as Prometheus's own 1-2 bytes/sample figure, so
  disk footprint is not meaningfully different between the two; the RAM/CPU
  claim is where VictoriaMetrics differentiates itself.
- Single-node VictoriaMetrics is explicitly positioned as sufficient for
  "moderately sized clusters" that would otherwise need a distributed system
  like Thanos/Cortex/M3DB
  ([single-server-victoriametrics §Prominent features](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#prominent-features)) —
  i.e. the cluster-mode (`vminsert`/`vmselect`/`vmstorage`) variant exists but
  is not needed at this scale; single-node is the right starting point and
  the same binary/data format carries forward if a migration to cluster mode
  is ever needed
  ([single-server-victoriametrics §Data migration](https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/#data-migration)).

### Metrics verdict

Both stacks give the same operational shape (Grafana + Prometheus-compatible
query API + kube-state-metrics + node-exporter + Alertmanager-compatible
alerting) and both are Helm-chart-installable with an operator managing CRDs.
The deciding factor for this constraint set is: VictoriaMetrics' own docs
claim materially lower RAM per unit of cardinality, RAM is the resource most
likely to be scarce on small k3s nodes, and disk footprint is roughly a wash.
Given the stated priority ("resource footprint... competes with workload apps
for capacity on small nodes"), **VictoriaMetrics stack single-node** is the
better starting point, with a documented, low-friction upgrade path to cluster
mode if node count/cardinality grows enough to need it.

## Logs: Loki vs. VictoriaLogs

### Grafana Loki

- Loki has three deployment modes: **monolithic** (all components in one
  binary/process, suited to "small read/write volumes of up to approximately
  20GB per day"), **Simple Scalable** (separates read/write/backend paths,
  scales to "close to a TB of logs per day," but is **being deprecated and
  will be removed in Loki 4.0**), and **microservices** (each component as its
  own process, "only recommended for very large Loki clusters")
  ([Loki deployment modes docs](https://grafana.com/docs/loki/latest/get-started/deployment-modes/)).
  Monolithic mode is the only one of the three not flagged as deprecated or
  overkill for a homelab, so that's the realistic comparison point.
- Loki's Helm chart's own current monolithic single-replica install docs
  deploy: Loki (1 replica), Loki Canary (DaemonSet), an NGINX gateway (1
  replica), a chunks-cache StatefulSet, a results-cache StatefulSet, and
  (currently, deprecated, being removed 2026-10-31) a bundled MinIO for object
  storage — the sample values even set `replication_factor: 1` and warn it's
  required or "requests will fail"
  ([Loki Helm install (monolithic) §Single Replica](https://grafana.com/docs/loki/latest/setup/install/helm/install-monolithic/)).
  That is five to six workloads for a single-replica logging setup before any
  external object store is even counted.
- Chunk storage does still support a plain **filesystem** backend — Loki's own
  storage docs describe it as "the simplest backend for chunks... common for
  single binary deployments" — but this is *not* what the current official
  Helm chart's documented monolithic example configures (it configures S3);
  filesystem-backed Loki is more of a bare-binary/local-dev pattern than the
  chart-blessed Kubernetes path
  ([Loki Storage docs §File system](https://grafana.com/docs/loki/latest/storage/#file-system),
  [§Examples: Single machine/local development](https://grafana.com/docs/loki/latest/storage/#single-machinelocal-development-tsdbfilesystem)).
  In other words: to follow Loki's supported Kubernetes install path today, an
  operator is steered toward standing up (or renting) S3-compatible storage
  in addition to the Loki pods themselves — extra footprint and an extra
  moving part for a small homelab.

### VictoriaLogs

- VictoriaLogs is described in its own docs as "resource-efficient and fast,"
  using "up to 30x less RAM and up to 15x less disk space than other
  solutions such as Elasticsearch and Grafana Loki," and explicitly "runs
  smoothly on Raspberry PI"
  ([VictoriaLogs README §Features](https://docs.victoriametrics.com/victorialogs/#features)).
  As with the metrics-side comparison, these are vendor-authored comparative
  figures (linked to the vendor's own benchmark posts), not independently
  audited — cited here as the vendor's own claim, not a verified fact.
- Architecturally the claim is plausible regardless of the exact multiplier:
  VictoriaLogs is "a single zero-config executable"
  ([VictoriaLogs README §Features](https://docs.victoriametrics.com/victorialogs/#features)),
  needs "no need in tuning" out of the box, and its docs' own capacity-planning
  guidance is just "leave 50% spare RAM, 50% spare CPU, 20% free disk" — no
  external object store, cache tier, or gateway proxy required
  ([VictoriaLogs docs §Tuning](https://docs.victoriametrics.com/victorialogs/#tuning),
  [§Capacity planning](https://docs.victoriametrics.com/victorialogs/#capacity-planning)).
  It integrates with the same Grafana instance via a native Grafana plugin
  ([VictoriaLogs README §Features](https://docs.victoriametrics.com/victorialogs/#features)),
  and if the VictoriaMetrics metrics stack above is adopted, VictoriaLogs slots
  into the *same* VictoriaMetrics Operator (via `VLSingle`/`VLCluster` CRDs) and
  the same `victoria-metrics-k8s-stack` chart, so there's no second operator or
  install path to maintain
  ([victoria-metrics-k8s-stack README §Logs storage and collection](https://docs.victoriametrics.com/helm/victoria-metrics-k8s-stack/#logs-storage-and-collection)).

### Logs verdict

For a small, growing homelab where node RAM/disk is the scarce resource and
where a self-hosted S3-compatible object store is not something to
provision just to satisfy a logging chart's default path, **VictoriaLogs
single-node** is the clearly better fit: one zero-config binary, filesystem
storage, no forced object-store dependency, and (if VictoriaMetrics is chosen
for metrics) shared operator/chart tooling with the metrics stack.

## Alerting channels

### Current design in this repo (already decided, not re-litigated here)

`docs/notifications.md` in this repo already specifies the alerting-delivery
architecture for the whole cluster, independent of which metrics stack is
chosen:

- **Apprise API** (`caronc/apprise`) as an internal-only gateway that any
  service — including a future Alertmanager/VMAlert — POSTs to.
- **Pushover** as the push channel: a hosted relay (not self-hosted), chosen
  specifically so that alert delivery does not depend on the homelab's own
  ingress/DNS/certs being healthy — the delivery path is a single outbound
  HTTPS POST from the cluster to `api.pushover.net`.
- **AWS SES** as the email channel, via Apprise's native `ses://` plugin.
- The doc explicitly states this is designed so that "when a metrics stack
  lands later, Alertmanager plugs into the same gateway with no rework" and
  lists "Prometheus/kube-state-metrics/Grafana" as the deferred observability
  seam this ticket is now filling in.

This ticket's job is to confirm that plan is still sound against primary
alerting-channel docs, and to check the two self-hosted push alternatives the
issue explicitly asks about (ntfy, Gotify) as a point of comparison — not to
relitigate the existing decision.

### Wiring Alertmanager/VMAlert into the existing Apprise gateway

- Alertmanager's generic `webhook_config` receiver POSTs a fixed JSON schema
  by default (`version`, `groupKey`, `status`, `receiver`, `alerts`, etc.), but
  it also supports an optional `payload:` field — a map of Go-template strings
  that lets an operator define a **fully custom JSON payload**, with the doc's
  own caveat that this is an advanced, unsupported, "use at your own risk"
  option
  ([Alerting configuration docs §`<webhook_config>`](https://prometheus.io/docs/alerting/latest/configuration/#webhook_config)).
  Practically, this means Alertmanager can be configured to POST directly in
  the `{title, body, type, tag}` shape Apprise's `/notify/{key}` endpoint
  expects (per `docs/notifications.md`'s own Apprise API section), with no
  separate translator/adapter service needed.
- If VictoriaMetrics is chosen for metrics (per the recommendation above),
  **VMAlert** is the alert-rule evaluator; the `victoria-metrics-k8s-stack`
  chart deploys it alongside a `VMAlertmanager` custom resource that is
  API-compatible with upstream Alertmanager
  ([victoria-metrics-k8s-stack README §Overview](https://docs.victoriametrics.com/helm/victoria-metrics-k8s-stack/#overview);
  operator resource reference lists `VMAlertmanager`/`VMAlertmanagerConfig`
  alongside `VMAlert`: [VictoriaMetrics Operator resources index](https://docs.victoriametrics.com/operator/resources/vmalertmanager/)).
  So the same `webhook_config`-with-custom-`payload` approach applies whether
  Prometheus's own Alertmanager or VMAlertmanager is used — this is not a
  differentiator between the two metrics-stack choices.

### Self-hosted push alternatives considered by the issue (ntfy, Gotify)

Included here because the issue explicitly asks for them to be surveyed, even
though `docs/notifications.md` already made and justified a different choice.

- **ntfy** ships as a single statically linked Go binary (tarball, deb/rpm,
  Docker image, arm64/armv7/amd64 supported)
  ([ntfy docs — Installing ntfy](https://docs.ntfy.sh/install/)). Official
  install docs describe binary/package/Docker installation but do not publish
  an official minimum-RAM/CPU figure — no primary-source resource-footprint
  number to cite either way.
- **Gotify** is a self-hosted Go server for sending/receiving messages via
  REST API and WebSocket, with official Docker images and CLI/Android client
  ([gotify/server README](https://github.com/gotify/server/blob/master/README.md)).
  Same caveat: no official resource-sizing numbers published in the primary
  repo docs.
- Both are architecturally lightweight (single Go binaries, no mandatory
  external DB beyond an embedded/sqlite-style store), so footprint is not
  really where they lose to the current design — the design rationale in
  `docs/notifications.md` for preferring hosted Pushover over self-hosted
  ntfy/Gotify is specifically about **failure correlation**: a self-hosted push
  server puts the homelab's own ISP/DNS/Traefik/cert/node-health stack on the
  critical path for the exact alert meant to report that stack is broken, and
  (for ntfy specifically) iOS delivery is already partially vendor-dependent
  (APNs wake-up must relay through `ntfy.sh`) while still requiring the phone
  to reach the self-hosted server for the message body — "the worst of both
  worlds." That reasoning is independent of resource footprint and still holds
  regardless of which metrics stack is chosen.

### Email

AWS SES via Apprise's native `ses://` plugin is already the decided email path
(`docs/notifications.md` §3); no change indicated by this research. The one
open item already tracked there is the SES sandbox requiring a verified
sender/domain and a production-access request to email arbitrary recipients —
unrelated to the metrics/logs stack choice.

### Alerting verdict

No change recommended to the existing Apprise/Pushover/SES design. The only
new finding from this research is confirmation, from Alertmanager's own docs,
that the "Alertmanager plugs into the same gateway with no rework" assumption
in `docs/notifications.md` holds in practice via `webhook_config`'s custom
`payload:` templating — and that this applies identically whether the eventual
alert evaluator is upstream Alertmanager (kube-prometheus-stack) or
VMAlert/VMAlertmanager (VictoriaMetrics stack).

## Summary table

| Concern | Recommended | Alternative considered | Why not the alternative |
| --- | --- | --- | --- |
| Metrics | VictoriaMetrics stack (`victoria-metrics-k8s-stack`, single-node `VMSingle`) | kube-prometheus-stack (Prometheus Operator) | Same CRD/dashboard/alerting UX, but vendor docs claim materially higher RAM use per cardinality for Prometheus; disk footprint is comparable either way |
| Logs | VictoriaLogs single-node | Grafana Loki (monolithic) | Loki's current Helm-blessed install path requires S3-compatible object storage (MinIO/cloud) even at 1 replica; VictoriaLogs is one zero-config binary on local filesystem storage |
| Push alerting | Pushover via Apprise (already decided in `docs/notifications.md`) | Self-hosted ntfy / Gotify | Lightweight either way; the deciding factor is failure-correlation (self-hosted push depends on the same infra it's alerting about), not resource footprint |
| Email alerting | AWS SES via Apprise (already decided) | — | No change indicated |

## Sources consulted

- kube-prometheus-stack README — https://github.com/prometheus-community/helm-charts/blob/main/charts/kube-prometheus-stack/README.md
- Prometheus Storage docs — https://prometheus.io/docs/prometheus/latest/storage/
- Prometheus Alerting configuration docs (`webhook_config`) — https://prometheus.io/docs/alerting/latest/configuration/
- VictoriaMetrics single-node docs — https://docs.victoriametrics.com/victoriametrics/single-server-victoriametrics/
- VictoriaMetrics cluster docs — https://docs.victoriametrics.com/victoriametrics/cluster-victoriametrics/
- victoria-metrics-k8s-stack Helm chart docs — https://docs.victoriametrics.com/helm/victoria-metrics-k8s-stack/
- VictoriaMetrics Operator quick start — https://docs.victoriametrics.com/operator/quick-start/
- VictoriaMetrics "Understand Your Setup Size" guide — https://docs.victoriametrics.com/guides/understand-your-setup-size/
- VictoriaLogs docs — https://docs.victoriametrics.com/victorialogs/
- Grafana Loki deployment modes — https://grafana.com/docs/loki/latest/get-started/deployment-modes/
- Grafana Loki Helm install (monolithic) — https://grafana.com/docs/loki/latest/setup/install/helm/install-monolithic/
- Grafana Loki storage docs — https://grafana.com/docs/loki/latest/storage/
- ntfy install docs — https://docs.ntfy.sh/install/
- Gotify server README — https://github.com/gotify/server/blob/master/README.md
- This repo's existing design: `docs/notifications.md` (Apprise/Pushover/SES)
