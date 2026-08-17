# Observability: VictoriaMetrics + VictoriaLogs + VictoriaTraces, single-node on the platform cluster

Status: accepted

Adopt the **VictoriaMetrics ecosystem** for all three observability signals — metrics
(`VMSingle`), logs (`VLSingle`), and traces (`VTSingle`) — via the `victoria-metrics-k8s-stack`
Helm chart, over the Grafana-Labs-native equivalents (`kube-prometheus-stack`, Loki, Tempo). Per
[research #29](https://github.com/aaronkyriesenbach/catalyst/issues/29) and follow-up
benchmarking during [Decide observability stack and alerting channels #30](https://github.com/aaronkyriesenbach/catalyst/issues/30):
official VictoriaMetrics-run benchmarks show materially lower RAM (~1.8x less for metrics, ~35x
less for logs) and disk (~2.5x less for metrics, ~4x less for logs) than Prometheus/Loki at
matched ingestion rates, at the cost of somewhat higher CPU on the logs side (~1.8x) — an
acceptable trade given RAM is this homelab's scarcest resource on small k3s nodes.

**Traces: VictoriaTraces over Tempo**, reversing an initial in-session recommendation.
VictoriaTraces is pre-GA (its own roadmap: data-structure/backward-compatibility not yet
finalized), but a VictoriaMetrics maintainer confirmed (July 2026,
[VictoriaTraces#212](https://github.com/VictoriaMetrics/VictoriaTraces/issues/212)) production
users already exist and that the pre-GA risk is specifically about _long-retention_ data
surviving a future breaking format change — a non-issue given the 7-day trace retention adopted
below. VictoriaTraces also shares the exact chart/operator already adopted for metrics/logs
(`VTSingle`/`VTCluster` CRDs) and auto-provisions a Grafana Jaeger-datasource with no extra
plugin, whereas Tempo would be a fully separate chart/binary/config surface. Known gap: TraceQL
structural operators (`>>`, `!<`) are unsupported with no plan to add them — accepted since basic
search/RED/alerting doesn't need them.

**Grafana remains the dashboard layer** — `vmui`'s "predefined dashboards" are static JSON panel
configs requiring a binary rebuild or a static file path, not an interactive builder; there is no
Victoria-native Grafana substitute. Grafana ships as a dependency of the same
`victoria-metrics-k8s-stack` chart.

**Trace-derived alerting**: VMAlert queries VictoriaTraces directly via LogsQL stats queries
(VictoriaTraces is built on VictoriaLogs) using hand-written recording rules, remote-writing
results into VictoriaMetrics — the DIY equivalent of Tempo's automatic
`traces_spanmetrics_*`/`traces_service_graph_*` processors, which VictoriaTraces doesn't provide.

**Collection**: a single OpenTelemetry Collector per cluster (not three specialized agents) —
one moving part per node instead of three, receiving OTLP traces/metrics/logs and
exporting via `prometheusremotewrite`/OTLP to the platform cluster's stores.

**Placement and topology**: the entire stack (`VMSingle`/`VLSingle`/`VTSingle`/`VMAlert`/Grafana)
runs single-node, exclusively on the platform cluster per ADR 0002 — workload clusters run only
the OTel Collector. Backing storage is **Runtime storage** (`truenas-iscsi`/`nvmeof`, RWO,
`Recreate`) per `CONTEXT.md`, consistent with all three stores being single-writer processes.
Retention: 90 days metrics, 30 days logs, 7 days traces.

**Alerting channel is unchanged**: the existing Apprise → Pushover (push) + AWS SES (email)
design (`docs/notifications.md`) needs no rework — VMAlert wires in via Alertmanager-compatible
`webhook_config` with a custom `payload:` template targeting Apprise's `/notify/{key}`.

**Grafana auth**: wired to the current IdP (Pocket ID) now, via bare `withOidcAuth()` (no
forward-auth middleware) — Grafana consumes the `<app>-oidc-credentials` secret directly through
its own native `auth.generic_oauth` support, same pattern as Miniflux/Jellyfin/open-webui. Not
blocked on the deferred unified-identity-platform decision
([#13](https://github.com/aaronkyriesenbach/catalyst/issues/13)).

**Deliberately not decided here**: how the per-cluster OTel Collector gets deployed onto the
External and Internal workload clusters and where it remote-writes cross-cluster — split off to
[Decide cross-cluster observability-collector deployment mechanics](https://github.com/aaronkyriesenbach/catalyst/issues/44),
blocked by [#42](https://github.com/aaronkyriesenbach/catalyst/issues/42), mirroring how
[#40](https://github.com/aaronkyriesenbach/catalyst/issues/40) split off DBaaS
provisioning/connectivity mechanics.
