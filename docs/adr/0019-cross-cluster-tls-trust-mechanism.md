# Cross-cluster TLS trust: SPIRE-native where the consumer can take it, static CA-embed otherwise

Status: accepted

Split off from [#49](https://github.com/aaronkyriesenbach/catalyst/issues/49) (Decide how OpenBao-backed
secrets reach ESO on workload clusters), which settled the steady-state secrets-flow shape but left open
how a workload cluster actually validates a TLS connection to something hosted on the platform cluster —
a problem bigger than OpenBao alone (also applies to CNPG's server certificate, ADR 0010, and any future
cross-cluster HTTPS/TLS consumer such as #44's observability remote-write).

## Decision

- **cert-manager's `internal-ca` stays independent per cluster** — extending ADR 0009's "no shared trust
  between clusters" precedent (there scoped to the service mesh's own root CA) to cert-manager generally.
  Nothing cross-cluster here needs a shared root: the actual need is "can cluster B validate a specific
  cert cluster A presents," which a one-time exported cert satisfies without the blast-radius cost of a
  shared root private key across all three clusters.
- **The general rule for every cross-cluster TLS consumer**: present a SPIRE-issued X.509-SVID directly
  if the consumer's TLS listener config accepts an external file/CSI-mounted certificate with a reload
  story; otherwise, the producing service's own CA cert (cert-manager-issued or operator-generated) is
  copied **once**, via OpenBao KV, into a plain Kubernetes `Secret` on the consuming workload cluster.
  This is the one convention every current and future consumer checks itself against, rather than each
  ticket inventing its own hand-off.
- **OpenBao's own HTTPS listener adopts SPIRE-native**: `tls_cert_file`/`tls_key_file` are plain file
  paths, reloaded on `SIGHUP` — no `Secret` indirection at all. A SPIFFE CSI-mounted volume plus a small
  sidecar sending `SIGHUP` on rotation lets OpenBao present a SPIRE-issued SVID directly; workload-cluster
  ESO validates it against the SPIRE trust bundle it already has locally via its own Agent (ADR 0014) —
  no static `caBundle` embed needed for this consumer at all. SPIRE is already live before OpenBao's first
  boot (ADR 0018's sequencing), so there's no bootstrap ordering problem.
- **CNPG's server certificate stays off SPIRE, on the static-embed path.** CNPG's `serverTLSSecret`/
  `serverCASecret` require an actual Kubernetes `Secret` object (`kubernetes.io/tls` + a `ca.crt` secret),
  not a file path or Workload API socket — and no reliable mechanism exists in the SPIFFE ecosystem to
  materialize a live SVID into a Kubernetes `Secret` (a known, still-open gap — see
  [spiffe/spiffe#369](https://github.com/spiffe/spiffe/discussions/369), which hits the identical problem
  for FluxCD). Building that bridge would be new, security-critical, homegrown code — the category ADR
  0013 already declined to build for a smaller problem. CNPG's server side therefore stays on
  cert-manager/operator-managed certs, generalizing #49's already-sketched hand-off ("the CNPG CA rides
  through OpenBao like any other KV secret"): the CA cert is copied once via OpenBao KV into a plain
  `Secret` on the workload cluster. ADR 0014's **client**-side X.509-SVID auth for CNPG is unaffected —
  only the server side was in question here.

## Considered Options

- **One shared internal root CA across all 3 clusters** — rejected: no cross-cluster need actually
  requires a shared root, and it would cut against ADR 0009's own blast-radius-containment rationale for
  keeping cluster trust roots independent.
- **SPIRE-issued server cert for CNPG** — rejected: mechanically blocked by CNPG's own API surface
  (`Secret`-object-only, no file-path option) and the absence of any SPIFFE-SVID-to-Kubernetes-Secret
  bridge in the ecosystem; would require bespoke, security-critical glue code for one consumer.
- **Static CA-embed for OpenBao too (uniform mechanism everywhere)** — rejected in favor of the
  SPIRE-native path for OpenBao specifically: OpenBao's listener config is a clean file-path fit, SPIRE is
  already a prerequisite dependency by the time OpenBao boots, and its ESO consumers already speak SPIRE
  for auth, so the added SVID-based TLS validation is an incremental step, not a new mechanism to
  maintain.

## Consequences

- OpenBao's Helm values need a SPIFFE CSI-mounted volume and a sidecar (e.g. `spiffe-helper`) sending
  `SIGHUP` on SVID rotation — new operational surface for `apps/openbao.ts`, on top of ADR 0018's
  self-init bootstrap.
- CNPG's `Cluster` CRs (per #40) reference a `serverCASecret`/`serverTLSSecret` sourced from cert-manager
  (or CNPG's own operator-managed CA), with the CA cert exported once via OpenBao KV and materialized as
  a plain `Secret` on the consuming workload cluster — no change to ADR 0014's client-cert-auth plan.
- Future cross-cluster TLS consumers (e.g. #44's OpenTelemetry Collector cross-cluster remote-write) check
  themselves against this ADR's two-path rule instead of re-deciding the mechanism from scratch.
