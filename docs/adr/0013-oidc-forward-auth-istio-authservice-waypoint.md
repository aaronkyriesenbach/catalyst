# OIDC forward-auth under Istio: `authservice` with per-app waypoints

Status: accepted

## Context

ADR 0009 replaced Traefik with Istio but explicitly deferred forward-auth reimplementation:
Traefik's plugin + `Middleware` + `ExtensionRef` shape (`docs/forward-auth.md`,
`withOidcAuth({ middleware: true })`) has no direct Istio equivalent. Istio's documented pattern is an
`AuthorizationPolicy` with `action: CUSTOM` delegating to an external authorizer via Envoy's `ext_authz`
protocol. Three apps currently use this (`forscore`, `reader`, `qbittorrent`); none use the
`bypassPaths`/custom-`headers` options.

## Decision

**External authorizer: [`authservice`](https://github.com/istio-ecosystem/authservice) (istio-ecosystem),
not `oauth2-proxy`.** `oauth2-proxy`'s multi-provider support is documented as incomplete (long-standing
open issue, unmerged partial PRs) — using it would force one separate `oauth2-proxy` instance per
protected app, each needing its own `extensionProviders` mesh-config entry. `authservice`'s native
multi-tenant `chains` config lets **one shared instance** hold a distinct OIDC client per app (via
`client_secret_ref` reading each app's existing `<app>-oidc-credentials` Secret from
`pocket-id-operator`), needing only **one** `extensionProviders` registration, ever — not one per app.
Per-app requests are routed to the correct `authservice` chain via a custom header (e.g. `x-app: <name>`)
injected by the app's own `HTTPRoute` `RequestHeaderModifier` filter, not `Host`-header matching, which
`authservice` has had rough edges with historically.

Alternatives considered for the authorizer role:

- **Authelia / Authentik** — rejected: neither supports acting as an OIDC relying party against an
  external IdP; both are designed to _be_ the IdP, which would mean replacing Pocket ID (out of scope —
  human identity provider choice is deliberately deferred elsewhere on the map).
- **Ory Oathkeeper** — rejected: ambiguous/weak browser-redirect OIDC login-flow support, and needs a
  Kratos companion service, adding real deployment weight for 3 apps.
- **Pomerium** — rejected: has a documented Istio `ext_authz` integration, but a real, not-fully-resolved
  history of intermittent `ext_authz_error`s specifically on this integration path — not acceptable
  maturity for a security-critical gate, and a heavier, more opinionated system than 3 apps justify.
- **Rolling a custom implementation** — rejected outright. Correct OIDC RP behavior (JWKS rotation, CSRF/
  state validation, open-redirect protection, session cookie security, Envoy `ext_authz` protocol
  conformance) is exactly the kind of security-critical protocol code not worth hand-rolling for a
  single-operator homelab.

**Enforcement point: per-app waypoint proxies**, not an `AuthorizationPolicy` on the shared Istio ingress
Gateway workload directly. A waypoint (`gatewayClassName: istio-waypoint`) keeps every per-app resource —
waypoint `Gateway`, `AuthorizationPolicy`, Service labels — self-contained in the app's own
namespace/render output, matching this repo's per-app render model and today's Traefik
`Middleware`-per-app pattern closely. This requires enabling Istio's `ENABLE_INGRESS_WAYPOINT_ROUTING`
(beta since 1.24/1.25) once, mesh-wide, plus an `istio.io/ingress-use-waypoint` label per protected app
Service — ingress-originated traffic bypasses destination-service waypoints by default.

Gateway-level enforcement (an `AuthorizationPolicy` selecting the shared ingress Gateway workload
directly, scoped via `to.operation.hosts`, no waypoint) was a close alternative: no beta flag, one fewer
proxy hop, and — once `authservice` is the authorizer — no worse a mesh-config footprint. It was rejected
because its `AuthorizationPolicy` resources must live in the Gateway's own shared/root namespace rather
than the app's own namespace, a genuinely new pattern this repo's per-app render model doesn't otherwise
have. Self-containment was prioritized over the small efficiency gain.

**Per-app Pocket ID access control (`PocketIDUserGroup` + `PocketIDOIDCClient`) is unchanged** — only the
enforcement mechanism and authorizer change.

**The Lab(Infra)→Management admin-UI proxy routes (UniFi/TrueNAS/Proxmox,
`apps/traefik/externalApps.config.ts`) remain intentionally ungated by forward-auth** — they have their
own native auth and don't support OIDC. ADR 0009's characterization of this as a pre-existing "gap" was
incorrect; corrected here.

## Considered Options

See authorizer and enforcement-point alternatives above.

## Consequences

- `withOidcAuth({ middleware: true })` needs to generate a per-app waypoint `Gateway`, an
  `AuthorizationPolicy` (`CUSTOM`, `provider: authservice`), Service labels
  (`istio.io/use-waypoint`, `istio.io/ingress-use-waypoint`), and an `HTTPRoute` header-injection filter —
  replacing the Traefik `Middleware` + ESO plugin-secret + `ExtensionRef` filter shape. Concrete manifest
  shapes and `utils.ts`/`modifiers.ts` code changes are implementation, not decided here.
- A new shared, manually-maintained resource emerges: `authservice`'s own `chains` config, needing a new
  `FilterChain` entry appended whenever an app adopts forward-auth — precedented by
  `cluster/traefik-config.yaml`'s existing manually-maintained Traefik plugin declaration.
- The mesh-wide `extensionProviders` registration for `authservice`, and the one-time
  `ENABLE_INGRESS_WAYPOINT_ROUTING` flag, are one-time platform-Istio-install-time settings (likely
  `apps/istio.ts`), not touched per app.
