# Research: identity-platform-based machine-identity brokering as an alternative to SPIFFE/SPIRE

**Ticket**: [#56](https://github.com/aaronkyriesenbach/catalyst/issues/56) — feeds [Decide machine-identity
mechanism for workload identity across the multi-cluster platform
(#55)](https://github.com/aaronkyriesenbach/catalyst/issues/55), alongside
[#54's findings](https://github.com/aaronkyriesenbach/catalyst/issues/54)
(`docs/research/machine-identity-research.md`, branch `research/machine-identity-research` — SPIFFE/SPIRE,
Istio-ambient reuse, OpenBao's own auth methods, this repo's existing IRSA pattern, cloud-native prior art)
and [#13's findings](https://github.com/aaronkyriesenbach/catalyst/issues/13)
(`docs/research/identity-research.md`, branch `research/identity-research` — Pocket ID, Authentik, Zitadel,
Kanidm, Keycloak, Authelia surveyed only for passkey/invite-email criteria) — part of the ["Homelab platform
rearchitecture" wayfinder map](https://github.com/aaronkyriesenbach/catalyst/issues/1).

**Scope**: #54 found no option that unifies workload identity across all three clusters without either a
dedicated second control plane (SPIRE) or hitting Omni's `cluster.serviceAccount` reservation (this repo's
existing IRSA pattern). This document investigates a third shape #54 didn't consider: an **identity platform
acting as a federation/token-exchange broker** — trusting each cluster's own Kubernetes
`service-account-issuer`/JWKS as an _inbound_ federated identity source, then vending its own token outward
to AWS IAM (`sts:AssumeRoleWithWebIdentity`) and to OpenBao (its generic `jwt` auth method). Per this
ticket's own instructions, the survey is **not** limited to the platforms #13 already named — it re-checks
those five (Pocket ID, Authentik, Zitadel, Kanidm, Authelia) plus Keycloak specifically for this new
machine-identity angle, and separately investigates Dex and ORY Hydra (the ticket's explicit starting
points) plus Casdoor (surfaced by this research). **It does not decide anything** — the decision is
deferred to the grilling session in [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55).

**A note on source dates**: every primary source below was fetched live during this research; several
projects' current release timelines (Ory, Keycloak, ZITADEL, authentik) place "today" in 2026. Version
numbers and merge dates are quoted as observed at fetch time, not estimated.

---

## TL;DR

- **Contrary to this ticket's own framing that Dex is "usually used in the opposite federation
  direction," Dex has shipped a first-party mechanism for exactly this pattern since early 2024 — it is
  simply undocumented on Dex's own docs website.** Dex's `grants/tokenexchange.go` implements the RFC 8693
  `urn:ietf:params:oauth:grant-type:token-exchange` grant (merged
  [PR #2806](https://github.com/dexidp/dex/pull/2806), shipped in
  [v2.38.0](https://github.com/dexidp/dex/releases/tag/v2.38.0)), and Dex's generic `oidc` connector
  implements the `TokenIdentityConnector` interface, verifying a presented ID token against the connector's
  configured `issuer` **with client-ID/audience checking explicitly skipped**
  (`c.provider.Verifier(&oidc.Config{SkipClientIDCheck: true})`) — a Kubernetes cluster's own
  `service-account-issuer` can be registered as that `issuer` with no client ID/secret at all. This is a
  real, shipped, currently-maintained feature (`server/grants/tokenexchange.go`,
  `connector/oidc/oidc.go`) that neither dexidp.io's own docs pages nor this ticket's own framing describe —
  a genuine primary-source-vs-secondary-narrative gap surfaced by going to Dex's actual source and
  merge history rather than its docs site or general reputation.
- **Authentik is the single strongest fit surveyed, via two independent, complementary mechanisms — one
  mature, one brand-new.** A `client_credentials` grant + RFC 7523 `client_assertion` path (merged
  [PR #12083](https://github.com/goauthentik/authentik/pull/12083), 2024-12-03) lets a workload authenticate
  with a Kubernetes projected ServiceAccount token directly, validated against a **Federated OIDC Source**'s
  fetched JWKS — authentik's own docs carry a dedicated worked example titled **"Kubernetes service account
  tokens"** naming the exact fields to configure. A second, much newer RFC 8693 **Token Exchange** grant
  (merged [PR #23900](https://github.com/goauthentik/authentik/pull/23900), 2026-07-10, still shipping as
  release candidate `2026.8.0-rc7` at the time of this research) reuses the same Federated-OIDC-Source JWKS
  trust and additionally auto-provisions a `UserTypes.SERVICE_ACCOUNT` identity on first use.
- **Pocket ID and Authelia both have the same generic capability as authentik's mature path — an
  RFC 7523 client-assertion validated against a dynamically-fetched external JWKS/discovery URL — through
  already-adopted, comparatively lightweight building blocks, but bind per-workload rather than per-issuer.**
  Pocket ID's ["Federated Client Credentials"](https://github.com/pocket-id/website/blob/main/docs/guides/oidc-client-authentication.md)
  feature (since v1.3.0) has its
  own dedicated **"Kubernetes Service Account Tokens"** doc section and explicitly names SPIFFE/SPIRE, AWS
  IAM, Azure Workload ID, and Tailscale's `tsiam` as other supported external issuers by name — but "wildcards
  are not supported," so each distinct workload identity needs its own registered credential entry. Authelia
  has no similarly branded feature or worked example, but its plain OIDC Provider config
  (`token_endpoint_auth_method: private_key_jwt` + `jwks_uri` + `grant_types: [client_credentials]`) is the
  identical mechanism, unbranded.
- **Keycloak's Identity Brokering — flagged by #13's research as Keycloak's most feature-complete
  option — is a browser-redirect-only mechanism, unusable non-interactively; the feature that actually
  matches this ticket's ask is deprecated and disabled by default.** Keycloak's own Identity Broker flow
  docs describe nothing but Authorization-Code-Flow redirects. The external-to-internal case this ticket
  needs is only in the **Legacy (V1) Token Exchange**, which Keycloak's own docs state plainly: **"Token
  Exchange Service is Preview and Deprecated. This feature is not fully supported, disabled by default, and
  will be removed in future versions."** The modern, default-enabled Standard Token Exchange V2 explicitly
  **"supports only"** same-realm, Keycloak-token-to-Keycloak-token exchange — external tokens are out of
  scope for the supported path entirely.
- **Two more RFC 8693-shaped candidates were found and both have real, sourced gaps against this specific
  pattern.** ZITADEL's Token Exchange grant only accepts a bare external JWT **"in combination with a valid
  `actor_token` for impersonation"** (an ordinary external subject token alone is rejected), and its
  `audience` parameter **"may never contain an audience which was not already present"** in the original
  token — a documented block on setting a fresh `aud=sts.amazonaws.com`. Casdoor has both `client_assertion`
  and RFC 8693 Token Exchange in its own source, but both validate exclusively against Casdoor's own
  internally-issued, manually-pasted PEM certificates (`object/cert.go`'s `Cert.Certificate`/`PrivateKey`
  fields) bound to a specific pre-registered Casdoor `Application` — no `jwks_uri`/discovery-URL field
  exists anywhere in its config, so no external OIDC issuer can be trusted at all.
- **ORY Hydra provides no federation-in mechanism of any kind, by explicit design, and this is stated by
  Ory itself, not inferred.** Ory's own current agent-facing guidance states: **"Ory Hydra is NOT an
  identity provider. It is an OAuth2/OIDC server that delegates authentication to an external login
  provider... via a login-and-consent redirect flow."** Hydra's own OpenAPI spec confirms its token endpoint
  accepts no `subject_token`/`subject_token_type` parameters at all — the `oAuth2TokenExchange` name in that
  spec is Hydra's internal label for _any_ token-endpoint response, not an RFC 8693 implementation. Every
  authentication method, human or machine, must be hand-built as a separate "Login Provider" application —
  the same "roll your own security-critical protocol code" cost this repo's own ADR 0013 already rejected
  for a narrower problem (3 apps' forward-auth) than this ticket's fleet-wide machine identity. Kratos (Ory's
  identity-management product) adds nothing here either: its OIDC "Sources" are the same interactive,
  browser-redirect social-sign-in pattern as every other candidate's _human_-facing federation, and Kratos
  does not issue OAuth2 tokens itself regardless (that is Hydra's job).
- **A structural finding applies uniformly to every candidate that does clear Question 1**: Kubernetes'
  own `ServiceAccountIssuerDiscovery` feature (stable since v1.21) publishes each cluster's discovery/JWKS
  endpoints, but **only to callers inside that same cluster by default** — reaching them from a broker
  centralized on the platform cluster needs either an explicit admin action (rebinding the
  `system:service-account-issuer-discovery` `ClusterRole` to a broader group on every workload cluster) or a
  separately-hosted JWKS mirror, and this research could not confirm whether Omni's WireGuard-only
  cross-cluster reachability (ADR 0011, already-fixed context) even carries that traffic. So a broker
  collapses the _outward_-facing consumer fan-out (AWS + OpenBao each register once against one broker
  issuer, instead of once per cluster) but does not eliminate _inward_ per-cluster registration/reachability
  work — a real, non-zero, and honestly unresolved piece of this option regardless of which broker platform
  is chosen.
- **Kanidm has no relevant mechanism at all.** No `token-exchange`, `client_assertion`, or `jwt_bearer`
  string appears anywhere in Kanidm's own repository, and its own OAuth2 integration docs describe Kanidm
  purely as an authorization server for downstream resource-server clients, with no federation-in of any
  kind documented or found in source.

---

## Candidates surveyed

| Platform               | External-JWT inbound mechanism (Question 1)                                                                                     | Maturity / status                                     | One-line verdict                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------- |
| **Dex**                | RFC 8693 Token Exchange + generic `oidc` connector's `TokenIdentity` (audience check skipped)                                   | Shipped v2.38.0 (Jan 2024); undocumented on dexidp.io | Strong fit; docs lag the actual code              |
| **Authentik**          | (a) `client_credentials` + `client_assertion` vs. Federated OIDC Source JWKS; (b) RFC 8693 Token Exchange, same trust source    | (a) merged Dec 2024; (b) merged Jul 2026, still RC    | Strongest fit surveyed, two independent paths     |
| **Pocket ID**          | "Federated Client Credentials" — `client_assertion` + `jwks_uri`, named K8s/SPIFFE/Azure/Tailscale examples                     | Shipped v1.3.0                                        | Solid, but one registration per exact subject     |
| **Authelia**           | Generic OIDC `private_key_jwt` + `jwks_uri` + `client_credentials` (unbranded)                                                  | Standard OIDC Provider feature                        | Solid, same shape as Pocket ID, no worked example |
| **Keycloak**           | Identity Brokering (browser-only); Legacy V1 Token Exchange (`subject_issuer`) for external tokens                              | Legacy path deprecated, disabled by default           | Mechanically works, poor long-term bet            |
| **ZITADEL**            | Token Exchange (actor_token-only for external JWTs); JWT IdP (browser-redirect dance); Private Key JWT (static per-account key) | All shipped, mature                                   | Three partial mechanisms, none cleanly fits       |
| **Casdoor**            | RFC 8693 Token Exchange + `client_assertion`, both validated only against Casdoor-internal certs                                | Shipped                                               | No external-issuer trust mechanism found          |
| **ORY Hydra + Kratos** | None built-in — requires a hand-built "Login Provider" app for any authentication method                                        | N/A                                                   | Fails Question 1 by explicit design               |
| **Kanidm**             | None found in docs or source                                                                                                    | N/A                                                   | Fails Question 1                                  |

---

## Question 1: trust an external OIDC/JWT issuer as an inbound identity source, exchange for a platform-issued token

### Dex

Dex's Token Exchange grant is a real, currently-shipped feature, not a proposal. The merged design document
states the goal plainly:

> "Using this grant type, when clients start an authentication flow with Dex, in lieu of being redirected to
> their upstream IDP for authentication on demand, clients can present an independently obtained, valid
> token from their IDP to Dex. This is primarily useful in fully automated environments with job/machine
> identities, where there is no human in the loop to handle browser-based login flows."

— [Dex Enhancement Proposal (DEP) 2812](https://github.com/dexidp/dex/blob/master/docs/enhancements/token-exchange-2023-02-03-%232812.md).
The implementing PR, [#2806 "RFC 8693 OAuth 2.0 Token Exchange"](https://github.com/dexidp/dex/pull/2806),
merged 2023-07-01 and first shipped in
[v2.38.0](https://github.com/dexidp/dex/releases/tag/v2.38.0) (released 2024-01-25, confirmed by that
release's own changelog entry crediting the PR). The grant is **enabled by default**: Dex's own
`supportedTypes()` builds its advertised grant list from a fixed `allGrants` map that includes
`oauth2.GrantTypeTokenExchange: true` unconditionally, narrowed only if an operator explicitly sets
`AllowedGrantTypes` (`server/config.go`).

The connector side is the more important half for this ticket. Dex's connector interface package defines:

```go
type TokenIdentityConnector interface {
    TokenIdentity(ctx context.Context, subjectTokenType, subjectToken string) (Identity, error)
}
```

— [`connector/connector.go`](https://github.com/dexidp/dex/blob/master/connector/connector.go). The generic
`oidc` connector implements it (`var _ connector.TokenIdentityConnector = (*oidcConnector)(nil)`,
[`connector/oidc/oidc.go`](https://github.com/dexidp/dex/blob/master/connector/oidc/oidc.go)), and for a
presented `subject_token_type=urn:ietf:params:oauth:token-type:id_token`, verification is:

```go
case "urn:ietf:params:oauth:token-type:id_token":
    idToken, err := c.provider.Verifier(&oidc.Config{SkipClientIDCheck: true}).Verify(ctx, token.AccessToken)
```

— same file. `SkipClientIDCheck: true` means Dex validates the token's signature and issuer against the
connector's configured `issuer` only — **no audience/client-ID match is required** — so a Kubernetes
cluster's own `service-account-issuer` can be registered as that `issuer`, and any pod's own projected
ServiceAccount token (an OIDC-shaped JWT) verifies successfully regardless of which audience it was minted
for. The connector's `Config` struct requires only `Issuer string`; `ClientID`/`ClientSecret` are unused by
`Open()` unless set, matching the DEP's own claim that "the connector only needs to be configured with an
issuer, no client ID / client secrets are necessary."

**A documented-vs-shipped gap worth flagging plainly**: the DEP proposed a `resource` request parameter to
set the issued token's audience per-request, and an `audience` parameter to select the connector. Neither
survives in the shipped code — `server/grants/grants.go`'s `parseRequest()` parses only `subject_token`,
`subject_token_type`, `requested_token_type`, and reuses the pre-existing `connector_id` field, with no
`resource` field parsed anywhere. This matters for Question 2 below.

**Source-quality note**: this entire mechanism was confirmed against Dex's own source code and merged
design document/PR/release history — dexidp.io's own docs pages (connector reference, Kubernetes guide)
contain no mention of "token exchange" at all as of this research. The feature is real and shipped, but a
reader relying on Dex's docs site alone would not find it.

### Authentik

Authentik has **two** independent mechanisms that both satisfy this question, one considerably more mature
than the other.

**(a) `client_credentials` + RFC 7523 `client_assertion` against a Federated OIDC Source.** Authentik's own
machine-to-machine guide has a dedicated subsection titled **"Kubernetes service account tokens"**:

> "Projected Kubernetes service account tokens work with this flow. The cluster or an auxiliary service must
> expose the service account issuer through OpenID Connect discovery or a JWKS endpoint. In practice, this
> means you can: 1. Create a generic OAuth Source in authentik. 2. Configure the source with either the
> issuer's `.well-known/openid-configuration` URL or the issuer's JWKS URL. 3. Add that source to the OAuth2
> provider under Federated OIDC Sources. 4. Send the projected service account token as the
> `client_assertion` in the `client_credentials` request."

— [Machine-to-Machine (M2M) authentication](https://github.com/goauthentik/authentik/blob/main/website/docs/add-secure-apps/providers/oauth2/machine_to_machine.mdx).
The OAuth Source's own docs confirm the JWKS trust is intentional, not incidental: **"To simplify
machine-to-machine authentication, you can create an OAuth source as a trusted source of JWTs... Any JWT
issued by the configured source's JWKS can authenticate."**
— [OAuth source](https://github.com/goauthentik/authentik/blob/main/website/docs/users-sources/sources/protocols/oauth/index.mdx).
The result is that authentik **"creates or updates a generated service account"** on first use, of
`type=UserTypes.SERVICE_ACCOUNT` (confirmed in `authentik/providers/oauth2/token/base_fed.py`'s
`create_user_from_jwt`) — a genuine JIT-provisioning path, not a manual per-workload account. This mechanism
traces to [PR #12083 "Add provider federation between OAuth2 Providers"](https://github.com/goauthentik/authentik/pull/12083),
merged 2024-12-03 — roughly a year and a half of production maturity as of this research.

**(b) RFC 8693 Token Exchange, added much more recently.** Authentik's own docs describe the grant
identically to the RFC and note the required trust configuration:

> "The provider performing the exchange must be able to verify the subject token. Under Machine-to-Machine
> authentication settings, configure one of the following trust relationships: Add the provider that issued
> the subject token to Federated OAuth2/OpenID Providers. Add the source that issued the subject token to
> Federated OIDC Sources."

— [Token exchange](https://github.com/goauthentik/authentik/blob/main/website/docs/add-secure-apps/providers/oauth2/token_exchange.md).
The implementation (`authentik/providers/oauth2/token/token_exchange.py`,
`authentik/providers/oauth2/token/base_fed.py`) confirms the same JWKS-cache verification path as (a)
(`validate_jwt_from_source`, with `options={"verify_aud": False}` — audience checking explicitly skipped,
mirroring Dex's `SkipClientIDCheck`), and the same JIT service-account creation on an unresolved subject.
This grant landed via [PR #23900 "providers/oauth2: token exchange"](https://github.com/goauthentik/authentik/pull/23900)
(merged 2026-07-10) and [PR #24356 "token exchange delegation"](https://github.com/goauthentik/authentik/pull/24356)
(merged 2026-08-04). At the time of this research, authentik's most recent tagged release was
[`version/2026.8.0-rc7`](https://github.com/goauthentik/authentik/releases) (2026-08-10) — **still a release
candidate**, so this specific grant should be treated as materially newer and less field-tested than
mechanism (a).

### Pocket ID

Pocket ID's own docs describe "Federated Client Credentials" as an intentional, named feature, explicitly
scoped to machine identity and explicitly naming Kubernetes and SPIFFE/SPIRE among its supported issuers:

> "With Federated Client Credentials, OIDC clients can authenticate themselves... using JWT tokens signed by
> third-party Identity Providers (IdP)... for example: On apps running on Kubernetes, you can use service
> account tokens that are issued by the Kubernetes API server... [SPIFFE/SPIRE](https://spiffe.io/)... Any
> other OIDC-compliant IdP."

— [OIDC Client Authentication](https://github.com/pocket-id/website/blob/main/docs/guides/oidc-client-authentication.md),
which states this is "supported in Pocket ID starting with version 1.3.0." The doc includes a dedicated
**"Kubernetes Service Account Tokens"** subsection with exact field mappings:

> "Issuer: Value of the Kubernetes' API server's issuer... Subject: The value is in the format
> `system:serviceaccount:<namespace>:<service-account-name>`... JWKS URL (optional): The URL where the JWKS
> of the Kubernetes API server can be retrieved from. The default value is
> `<issuer>/.well-known/jwks.json`."

— same source. The verification is implemented as `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
client authentication (`backend/internal/oidc/federated_client_auth.go`, `jwksCache` fetched per configured
issuer), matching RFC 7523.

**A real per-subject limitation, sourced directly from the same doc**: each Federated Client Credential
entry binds to one specific, exact `sub` value — the doc's own Gitlab Pipelines example states **"Currently,
wildcards are not supported, so if you need to authenticate from pipelines running on different branches,
you will need to create a Federated Client Credential for each branch."** Applied to Kubernetes: N distinct
ServiceAccounts needing distinct identities require N separate Federated Client Credential entries (though
all can attach to the same or different OIDC Clients). A second, related nuance: because this is
`client_credentials` grant authentication (the client authenticates itself, not a "subject" being
impersonated), the _resulting_ Pocket ID access token's subject is `client-[client_id]` — the OIDC
**client's** identity, not the original Kubernetes ServiceAccount's — so distinguishing workloads in the
issued token requires one distinct OIDC Client per workload, not just one Federated Client Credential entry
per workload (per the docs' own Gitlab example: `echo "Successfully obtained token with subject:
client-$POCKET_ID_CLIENT_ID"`).

### Authelia

Authelia has no similarly named/branded feature, but its plain OpenID Connect 1.0 Provider configuration
provides the identical mechanism, unbranded. Its client config reference documents dynamic external-JWKS
trust directly:

> "The fully qualified, `https` scheme... URI for the JWKs endpoint that implements [RFC7517 Section
> 5]... This is mutually exclusive with `jwks`... It's recommended that you configure this option to
> account for key rotation... Required when the following options are configured to specific values:
> `token_endpoint_auth_method`: `private_key_jwt`."

— [OpenID Connect 1.0 Clients](https://github.com/authelia/authelia/blob/master/docs/content/configuration/identity-providers/openid-connect/clients.md)
(`jwks_uri` field). Combined with `grant_types: [client_credentials]` (the same doc: "the configured
`grant_types` includes the `client_credentials` grant in which case arbitrary scopes are expected") and
`token_endpoint_auth_method: private_key_jwt`, a registered Authelia OIDC client can be configured to trust a
Kubernetes cluster's own JWKS endpoint exactly the way Pocket ID's Federated Client Credentials does — but
Authelia's own docs carry no worked Kubernetes example the way Pocket ID's and authentik's do, and per RFC
7523 the client-assertion's `iss`/`sub` claims must match the registered `client_id`, implying the same
one-registration-per-exact-subject shape as Pocket ID (not independently confirmed beyond the RFC's own
requirement, since Authelia's docs don't spell out the matching rule explicitly the way Pocket ID's do).

### Keycloak

Keycloak's Identity Brokering — the feature #13's research flagged as Keycloak's most feature-complete
capability — is fundamentally a browser-redirect flow and nothing else, confirmed by Keycloak's own
description of the mechanism:

> "When using Keycloak as an identity broker, Keycloak does not force users to provide their credentials to
> authenticate in a specific realm. Keycloak displays a list of identity providers from which they can
> authenticate... Keycloak issues an authentication request to the target identity provider requesting
> authentication and redirects the user to the identity provider's login page."

— [Identity Broker overview](https://www.keycloak.org/docs/latest/server_admin/index.html) (Brokering
overview section). Its OpenID Connect v1.0 identity-provider config confirms the same: **"These identity
providers (IDPs) must support the Authorization Code Flow defined in the specification to authenticate users
and authorize access."** There is no non-interactive path through Identity Brokering itself.

The actual mechanism this ticket needs — presenting an externally-obtained token directly to a token
endpoint, no browser involved — exists only in Keycloak's **Legacy (V1) Token Exchange**, via a
`subject_issuer` parameter:

> "`subject_issuer` OPTIONAL. Identifies the issuer of the `subject_token`... Valid values are the alias of
> an Identity Provider configured for your realm... A client can exchange an external token for a Keycloak
> token."

— [Token Exchange](https://www.keycloak.org/securing-apps/token-exchange). But the same page states, as its
very first substantive sentence about this feature:

> "Legacy token exchange: version 1 (V1) - This preview feature is deprecated and not enabled by default
> once Keycloak server is started... Token Exchange Service is Preview and Deprecated. This feature is not
> fully supported, disabled by default, and will be removed in future versions. To enable start the server
> with `--features=preview` or `--features=token-exchange`."

— same source. The modern, default-enabled replacement, Standard Token Exchange V2, is explicit that it does
**not** cover this ticket's case at all: **"The standard token exchange supports only use-case (1)"** —
exchanging one Keycloak-issued token for another Keycloak-issued token for a different client **in the same
realm** — external tokens are simply not part of the supported, non-deprecated feature.

### ZITADEL

ZITADEL has three distinct JWT-related mechanisms, and none of them is a clean fit.

**Token Exchange** (RFC 8693) exists and is fully documented, but rejects a bare external JWT as a plain
subject:

> "When used as a `subject_token_type`, ZITADEL will try to verify the `subject_token` in a similar way as a
> JWT Profile... Currently we only allow self-signed JWT as `subject_token` in combination with a valid
> `actor_token` for impersonation. A self-signed JWT is not enough to obtain other token types from the
> Token Exchange Grant. You will need to use the JWT Profile grant instead."

— [OAuth 2.0 Token Exchange (RFC 8693): Impersonation & Delegation](https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/token-exchange.mdx).
In other words, an external JWT is only accepted as an _actor_ impersonating an already-known ZITADEL user,
not as a stand-alone machine subject.

**JWT IdP** federates an externally-issued JWT, but through a browser-redirect-shaped dance, not a
token-endpoint POST:

> "A JWT Identity Provider (JWT IdP) allows ZITADEL to accept a JSON Web Token (JWT) issued and signed by an
> external system as proof that a user has already been authenticated elsewhere... 3. If no session is
> found, ZITADEL redirects user to JWT endpoint. 4. JWT endpoint forwards token to ZITADEL. 5. ZITADEL
> responds to the JWT endpoint with an authorization code."

— [JWT IdP](https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/identity-providers/jwt_idp.mdx).
This is mechanically automatable by a script following redirects (there is no inherent human-interactive
step; the doc's own worked example is a same-domain Cloudflare Worker proxy, not a browser), but it is
designed and documented purely for legacy-session SSO reuse, not as a machine-credential-exchange endpoint —
substantially more involved than a single `subject_token` form field.

**Private Key JWT** (RFC 7523 client authentication) requires a pre-registered ZITADEL Service Account per
credential, with either a ZITADEL-generated key pair or **"upload your own (externally generated) public
key"** — [Private Key JWT Auth for Service Accounts](https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/service-accounts/private-key-jwt.mdx).
This is a static, per-account key-upload model (closer to GCP's own "upload JWKS directly" pattern, per #54's
own findings, cited above) rather than a whole-issuer JWKS trust — it does not scale to arbitrary,
dynamically created Kubernetes ServiceAccounts the way Dex/authentik/Pocket ID/Authelia's `jwks_uri`-based
trust does.

### Casdoor

Casdoor's own source confirms both an RFC 8693 Token Exchange grant and RFC 7523 `client_assertion`
support exist (`object/token_oauth_util.go`'s `parseAndValidateSubjectToken`, documented in-line as
validating "a `subject_token` for RFC 8693 token exchange," and `ValidateClientAssertion`). But both paths
resolve trust exclusively through Casdoor's own internal `Cert` records:

```go
clientCert, err := getCert(application.Owner, application.ClientCert)
...
claims, err := ParseJwtToken(clientAssertion, clientCert)
...
if !slices.Contains(application.RedirectUris, claims.Issuer) {
    return false, nil, nil
}
```

— [`object/token_oauth_util.go`](https://github.com/casdoor/casdoor/blob/master/object/token_oauth_util.go).
The `Cert` object itself has only `Certificate string` and `PrivateKey string` fields
([`object/cert.go`](https://github.com/casdoor/casdoor/blob/master/object/cert.go)) — manually pasted PEM
data, no `jwks_uri`/discovery-URL field anywhere in the type. The token-exchange path's own subject-token
verification resolves the signer via the token's `azp` claim looked up as **another Casdoor Application**
(`GetApplicationByClientId(unverifiedClaims.Azp)`), meaning the subject token must itself have been issued
by Casdoor. **No mechanism was found, in docs or source, for Casdoor to trust an arbitrary third-party OIDC
issuer's rotating JWKS** — every path is internal-to-internal or requires manually re-uploading a static
public key whenever the external issuer's key rotates.

### ORY Hydra (+ Kratos)

Ory's own current documentation is unambiguous that Hydra provides no federation-in mechanism at all — this
is Ory's own framing, addressed directly to anyone (including an LLM agent) evaluating the product:

> "Ory Hydra is NOT an identity provider. It is an OAuth2/OIDC server that delegates authentication to an
> external login provider (typically Ory Kratos) via a login-and-consent redirect flow. Don't recommend Ory
> Hydra alone for user login."

— [Ory's own `llms.txt`](https://www.ory.com/llms.txt) (published, first-party agent-facing guidance, not a
secondary summary). Hydra's login-flow guide confirms every authentication method is fully custom,
implemented by the adopter:

> "The application 'sitting' at that URL is implemented by you and typically shows a login user interface...
> This flow allows you to take full control of the behavior of your login system, authentication methods,
> and consent screen."

— [Login and consent flow](https://github.com/ory/docs/blob/master/docs/hydra/guides/login.mdx) (fetched via
ory.com/docs/hydra/guides/login). Hydra's own OpenAPI spec confirms there is no RFC 8693 support baked in:
the `/oauth2/token` endpoint's request schema accepts only `client_id`, `code`, `grant_type`, `redirect_uri`,
`refresh_token` — no `subject_token`/`subject_token_type`/`actor_token` fields exist anywhere in
[`spec/api.json`](https://raw.githubusercontent.com/ory/hydra/master/spec/api.json). The schema named
`oAuth2TokenExchange` in that spec is simply Hydra's generic label for "the token endpoint's response
object" (used for every grant type, not specifically RFC 8693) — a naming coincidence, not a feature.

Kratos, Ory's identity-management product, does not change this picture. Its own docs describe its external
IdP support as ordinary human-facing social sign-in: **"Out of the box, Ory comes with custom-tailored
connectors for 15+ social sign-in providers... you can connect any OpenID Connect-compliant identity
provider using the Generic provider integration."** — [Social sign-in](https://github.com/ory/docs/blob/master/docs/kratos/social-signin/overview.mdx)
(fetched via ory.com/docs/kratos/social-signin/overview). This is the same interactive, browser-redirect,
human-account-linking pattern every other candidate's _human_-facing federation uses — and Kratos does not
issue OAuth2/OIDC tokens itself in any case (that responsibility belongs entirely to Hydra, per Ory's own
architecture). Combining Kratos + Hydra for this ticket's machine-identity case would mean hand-building
the entire Login Provider bridge from scratch: exactly the "rolling a custom implementation" option this
repo's own [ADR 0013](https://github.com/aaronkyriesenbach/catalyst/blob/master/docs/adr/0013-oidc-forward-auth-istio-authservice-waypoint.md)
already rejected outright for a much smaller problem (3 apps' forward-auth) — _"Correct OIDC RP behavior...
is exactly the kind of security-critical protocol code not worth hand-rolling for a single-operator
homelab."_

### Kanidm

No evidence of any relevant mechanism was found. A repository-wide search of Kanidm's own source tree for
`exchange`, `federat`, and `jwt_bearer` returned zero matches. Kanidm's own OAuth2 integration docs describe
the product purely as an authorization server for downstream resource-server clients:

> "OAuth is a web authorisation protocol that allows 'single sign on.'... In general, Kanidm requires that
> your service supports three things: HTTP basic authentication to the authorisation server (Kanidm)..."

— [OAuth2](https://github.com/kanidm/kanidm/blob/master/book/src/integrations/oauth2.md). Nothing in this
document, or anywhere else in Kanidm's docs or source, describes Kanidm consuming an external OIDC/JWT
issuer as an inbound identity source. Kanidm fails Question 1 outright; Questions 2–5 are moot for it.

---

## Question 2: does the resulting token satisfy AWS IAM (`sts:AssumeRoleWithWebIdentity`) and OpenBao's generic `jwt` auth method?

Per #54's already-established findings (treated as fixed context here, not re-derived): AWS requires an
exact `aud` claim match against its IAM OIDC Identity Provider's registered audience list, with no
alternative binding mechanism. OpenBao's `jwt` auth method is more forgiving — its own API docs state that
for the default `role_type` (`"oidc"`), `bound_audiences` is **optional**, and a role can instead bind on
`bound_subject` or `bound_claims`:

> "`bound_audiences` (array: `<optional>`) - List of `aud` claims to match against... For 'jwt' roles, at
> least one of `bound_audiences`, `bound_subject`, `bound_claims` or `token_bound_cidrs` is required.
> **Optional for 'oidc' roles.**"

— [OpenBao JWT/OIDC Auth Method (API)](https://openbao.org/docs/api/auth/jwt/). So audience control matters
far more for the AWS leg of this question than the OpenBao leg.

- **Dex**: the issued token's `aud` defaults to the authenticating OAuth client's own `client_id`
  (`tok.Audience = GetAudience(clientID, auth.Scopes)`, [`server/tokens/claims.go`](https://github.com/dexidp/dex/blob/master/server/tokens/claims.go)) —
  not a request-time `resource` parameter (per Question 1's finding that this was proposed but never
  shipped). To get `aud=sts.amazonaws.com`, an operator would register a Dex Static Client whose ID
  literally _is_ `sts.amazonaws.com` and have the exchange call authenticate as that client — mechanically
  workable, but it reintroduces a shared static secret for the exchange call itself (though not a long-lived
  AWS credential). For OpenBao, this is a non-issue: bind on `bound_subject`/`bound_claims` instead of
  audience, and Dex's `oidc_discovery_url`-fetchable JWKS is fully compatible with OpenBao's generic `jwt`
  method regardless.
- **Authentik**: the `audience` request parameter on Token Exchange (and the target-provider selection on
  the `client_credentials` path) explicitly names a _different, pre-configured Provider_ by its `client_id`
  or application UUID, whose own issuer/`aud`/signing key mint the result — **"Set `audience` to request a
  token using a different provider's configuration... The resulting token uses the target provider's
  configuration... its `client_id` as `aud`."** — [Token exchange: Audience](https://github.com/goauthentik/authentik/blob/main/website/docs/add-secure-apps/providers/oauth2/token_exchange.md).
  Creating one dedicated Provider configured with `client_id=sts.amazonaws.com` (or whatever OpenBao's role
  expects) is a documented, first-class path — no narrowing-only restriction was found (unlike ZITADEL,
  below).
- **Pocket ID / Authelia**: both are standard OIDC Providers where `aud` follows ordinary OP conventions
  (the client's own identifier, per the client the token was issued to) — mechanically compatible with both
  AWS and OpenBao, at the cost of needing one dedicated OIDC Client per distinct target audience if AWS and
  OpenBao need different `aud` values.
- **Keycloak** (if the deprecated legacy path were used regardless): the legacy exchange has an explicit
  `audience`/`requested_issuer` parameter pair for steering the target client and even routing to an
  external provider entirely — mechanically the most flexible of everything surveyed — but this is moot
  given the feature's stated removal trajectory (Question 1).
- **ZITADEL — the one candidate with a documented, blocking audience quirk**: its Token Exchange docs state
  plainly, **"Audience is an optional parameter that allows to decrease the audience of the requested
  token... it may never contain an audience which was not already present in either the `subject_token` or
  `actor_token` combined."** — [Token Exchange: Audience](https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/token-exchange.mdx).
  ZITADEL's own audiences are also structurally UUID-project-ID-based reserved scopes
  (`urn:zitadel:iam:org:project:id:<uuid>:aud`), not arbitrary strings — there is no documented path to
  make `sts.amazonaws.com` appear as an audience value in the first place, so this narrowing-only rule is a
  genuine, sourced block on the AWS use case specifically (not merely an inconvenience).
- **Casdoor / ORY Hydra / Kanidm**: moot — none passes Question 1.

---

## Question 3: expose the platform's OIDC discovery/JWKS endpoint via Cloudflare Tunnel instead of a dedicated public host

This question is structurally identical across every candidate surveyed, and the answer is a clean **yes**
for all of them, with one shared caveat and one genuinely useful distinction.

**The generic mechanism, confirmed against Cloudflare's own docs**: Cloudflare Tunnel maps an arbitrary
public hostname straight to a local HTTP(S) service — _"When you publish an application, you map a public
hostname to a local service — for example, `app.example.com` to `http://localhost:8080`."_
— [Cloudflare Tunnel: Routing](https://developers.cloudflare.com/tunnel/routing/). Every candidate surveyed
here — Dex, authentik, Pocket ID, Authelia, Keycloak, ZITADEL, Casdoor, Hydra — is an ordinary Kubernetes
Service serving plain HTTPS, no different in kind from any other app this repo already fronts with
Cloudflare Tunnel (per #19's own resolution). None of them need this repo's existing IRSA pattern's
public-S3-bucket workaround (`irsa.md`), and none of them hit Omni's `cluster.serviceAccount` reservation
(#54) either, since a broker's own signing key is entirely its own application-layer concern, not a
Talos/Omni machine-config field.

**The one universal, non-Cloudflare-specific caveat**: whatever hostname is chosen becomes the permanent
`iss` value baked into every discovery document and issued token for that broker — a stable, chosen-up-front
hostname is required regardless of which platform is picked, exactly the precedent this repo's own
`auth.lab53.net` (Pocket ID, per `apps/pocket-id.ts`) already sets.

**A useful distinction this research surfaced**: the Cloudflare Tunnel exposure is only strictly required
for the **AWS-facing leg**. OpenBao already runs on the platform cluster (ADR 0004), and any of these broker
candidates would most naturally run there too if adopted as the "one unified instance" of Question 4 —
meaning OpenBao's `jwt` auth `oidc_discovery_url` can point at a private in-cluster Service DNS name with no
tunnel involved at all, while AWS STS (an external, non-cluster service) has no such shortcut and needs the
tunnel-exposed public hostname regardless of which broker is chosen.

---

## Question 4: does one broker instance federating all three clusters give a single, unified identity?

**The structural opportunity**: since ADR 0009 already commits each of the three clusters to its own
independent Istio root CA with no mesh span, each cluster's own Kubernetes API server is _also_, by
construction, its own independent OIDC issuer for projected ServiceAccount tokens. A single broker instance
hosted on the platform cluster could, in principle, be configured with three separate connector/source/client
entries — one per cluster's discovery+JWKS endpoint — aggregating all three clusters' inbound trust into one
place, then presenting exactly **one** outbound issuer/token to every consumer: AWS IAM registers the
broker's OIDC provider once, OpenBao configures the broker's `oidc_discovery_url` once. Adding a fourth
future consumer would cost zero additional cluster-side work — register it against the same broker issuer.
This is the same unification benefit #54 found only SPIRE's single-trust-domain topology could deliver,
achieved here by a much lighter, likely-already-adopted mechanism instead of a dedicated control plane.

**A real, sourced constraint on the inbound side that this research could not fully resolve**: Kubernetes'
own `ServiceAccountIssuerDiscovery` feature (stable since v1.21) publishes the discovery/JWKS endpoints, but
restricts them by default:

> "Clusters that use RBAC include a default ClusterRole called `system:service-account-issuer-discovery`. A
> default ClusterRoleBinding assigns this role to the `system:serviceaccounts` group, which all
> ServiceAccounts implicitly belong to. This allows pods running on the cluster to access the service
> account discovery document via their mounted service account token. Administrators may, additionally,
> choose to bind the role to `system:authenticated` or `system:unauthenticated` depending on their security
> requirements."

— [Kubernetes docs: Configure Service Accounts for Pods — ServiceAccount issuer discovery](https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/).
By default, then, a workload cluster's own discovery/JWKS endpoints are reachable only **from within that
same cluster** — a broker centralized on the platform cluster needs either an explicit, deliberate admin
action on every workload cluster (rebinding that `ClusterRole` to a broader group) or a separately-hosted
JWKS mirror (the same doc notes this is a supported pattern via `--service-account-jwks-uri`, echoing GCP's
own "local JWKS upload" option #54 already found as the one hyperscaler mechanism that doesn't need live
reachability). And per ADR 0011 (already-fixed context), the _only_ network path from the platform cluster
to either workload cluster's own Kubernetes API server at all is Omni's WireGuard-tunneled proxy — **this
research did not find a primary source confirming whether that specific proxy path even carries traffic to
these unauthenticated discovery endpoints**, as opposed to the authenticated, bearer-token `kubectl`-style
traffic ADR 0011 describes it handling. This is an honestly-flagged gap, not resolved either way here.

**Net assessment, applicable to every candidate that clears Question 1** (Dex, authentik, Pocket ID,
Authelia, and mechanically Keycloak's deprecated path): a broker collapses the _outward_-facing consumer
fan-out for real (N clusters × M consumers → N cluster-side registrations + M consumer-side registrations,
with M growing at zero marginal cluster-side cost), but it does **not** eliminate per-cluster registration
work on the _inbound_ side the way a literal single SPIRE trust domain spanning all three clusters would —
and if the Omni-proxy reachability question above resolves unfavorably, each workload cluster's operator
would additionally need some as-yet-undesigned side-channel to publish that cluster's JWKS somewhere the
broker can reach it. Pocket ID's and Authelia's per-subject (not per-issuer) registration model compounds
this further: even setting cluster-reachability aside, adding new _workloads_ (not just new clusters) inside
an already-connected cluster is itself N further registrations under those two platforms, whereas Dex's and
authentik's whole-issuer trust means new workloads inside an already-connected cluster need zero additional
broker-side configuration at all.

ZITADEL, Casdoor, ORY Hydra, and Kanidm inherit the same "moot" status here as in Questions 1–2: this
"aggregate three issuers into one" framing presupposes a working external-issuer-trust mechanism to begin
with, which none of these four cleanly has.

---

## Question 5: operational footprint of dual-purposing as both human IdP and machine broker, vs. SPIRE

Recall #54's already-established SPIRE footprint as the fixed comparison point: a 2-server HA floor, a
shared SQL datastore, and a Talos-PSA-`privileged` namespace for the Agent/CSI-driver — a genuine second
control plane, not a thin add-on.

- **Pocket ID** is already the single lightest-footprint candidate surveyed anywhere on this map (a single
  Go binary + SQLite/Postgres, already deployed as `apps/pocket-id.ts`). Federated Client Credentials is a
  configuration-only feature of that same already-running binary — literally zero new moving parts if
  Pocket ID stays the human IdP. The real cost here is _operational_, not infrastructural: N manual,
  no-wildcard credential-entry registrations as new workloads appear, per Question 1's finding.
- **Authentik** carries a materially heavier baseline (Django/Celery/Redis/Postgres, per #13's own prior
  research) — but that cost is identical whether or not machine-brokering is ever turned on, since it would
  be the same already-adopted-if-chosen human-IdP instance either way. Enabling either of authentik's two
  machine mechanisms is pure configuration (new Sources/Providers/policy objects), zero new infrastructure.
  Of every candidate surveyed, this is the clearest embodiment of the ticket's "genuinely dual-purposing a
  platform likely to be adopted anyway" framing — _contingent on_ #13's still-deferred human-IdP decision
  actually landing on authentik, which it has not.
- **Authelia** has a comparatively light footprint (no bundled Celery/Redis) and the same generic machine
  mechanism as Pocket ID — but #13's own resolution already ruled Authelia out as a human-IdP candidate
  outright (_"it isn't a user directory and has no invite mechanism of its own"_), so the "dual-purposing"
  frame doesn't really apply to it: adopting Authelia here would mean running it _alongside_, not instead
  of, whatever wins #13, a materially different (two-system) shape than this question envisions.
- **Keycloak** is the heaviest of the originally-flagged candidates (JVM) — and the specific feature this
  ticket needs sits on a stated deprecation path, meaning betting on Keycloak for this purpose risks having
  to migrate off the mechanism again later, a real footprint-adjacent risk on top of raw resource cost.
- **ZITADEL** carries a moderate-heavy footprint (Postgres, event-sourced) — largely moot in practice, since
  none of its three JWT-related mechanisms cleanly covers Question 1 without an actor-token workaround, a
  hand-built redirect proxy, or a static per-account key upload that doesn't scale to dynamic ServiceAccounts.
- **Dex, ORY Hydra + Kratos, and Casdoor were never candidates in #13's own human-IdP research, and this
  matters for how "dual-purposing" should be judged for them.** Dex has no native user database and cannot
  independently satisfy #13's passkey/invite-flow requirements at all; Hydra requires an entirely hand-built
  login application for any authentication method, human or machine; Casdoor's human-facing capabilities
  were not investigated in depth here since its machine-identity mechanism (Question 1) already disqualifies
  it for this ticket's specific purpose. Adopting any of these three here would mean running an **additional**
  component alongside a separately-chosen human IdP, not a consolidation — a different shape than this
  question's premise. That said, Dex itself is a genuinely light single Go binary (comparable in spirit to
  Pocket ID), so even purely as a second, machine-only app it is still meaningfully lighter than standing up
  SPIRE's 2-server/shared-datastore floor — it just doesn't get the "already adopted anyway" argument's full
  benefit, since nothing here would already be running it for another reason.
- **Kanidm** is moot (fails Question 1 outright).

---

## A note on candidates surveyed but not deep-dived

Two products surfaced during this research but were not pursued to the same depth, for honestly-stated
reasons rather than a dismissal on the merits:

- **Ory Talos** ("Secure AI Agent and Non-Human Identities with Macaroon Tokens for API Keys" —
  [ory.com/talos](https://www.ory.com/talos)) is a genuinely machine-identity-focused Ory product, but its
  entire mechanism is Macaroon-based delegation/token derivation for wrapping existing API keys, not
  OIDC/JWT issuance or federation — it does not fit this ticket's specific external-OIDC-trust-and-exchange
  pattern, so it was not evaluated against the five numbered questions.
- **Teleport** (Gravitational, AGPL-3.0, self-hostable) has a SPIFFE-adjacent "Workload Identity" feature
  set that this research's search surfaced as plausibly relevant, but Teleport is fundamentally a
  bastion/PAM (privileged access management) platform, a different product category than the OIDC-issuer
  brokers surveyed above. This research did not verify its specific external-issuer-federation or
  AWS/OpenBao-token-exchange mechanics against Teleport's own docs, and flags this as an open gap rather
  than making an unverified claim either way.

---

## Recommendation

None — by design, per this ticket's own instructions and the wayfinder map's split between research and
grilling. What this research contributes to the [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55)
grilling session:

- Dex and authentik both have real, shipped, sourced mechanisms for exactly the pattern this ticket asks
  about — Dex's is undocumented on its own docs site (source/PR/release-history confirmed instead), and
  authentik's newer Token Exchange grant is still a release candidate at the time of this research, while its
  older client-credentials/client-assertion path has roughly a year and a half of production maturity.
- Pocket ID and Authelia share the same generic mechanism as authentik's mature path, at a lighter
  (Pocket ID) or comparable (Authelia) infrastructure footprint, but both register trust per exact workload
  subject rather than per whole issuer — a real, ongoing operational cost distinct from Dex's/authentik's
  whole-issuer trust model.
- Keycloak's Identity Brokering (browser-only) does not address this ticket's need at all; the feature that
  does (Legacy V1 Token Exchange) is explicitly deprecated, disabled by default, and slated for eventual
  removal by Keycloak's own docs — a poor foundation to build on even though it is mechanically the most
  flexible option surveyed for controlling the resulting token's audience.
- ZITADEL and Casdoor both have RFC 8693-shaped grants that superficially resemble a fit, but each has a
  concrete, sourced gap (ZITADEL: actor-token-only acceptance of external JWTs, plus an audience-narrowing
  rule that blocks setting a fresh AWS audience; Casdoor: internal-certificate-only trust, no external-issuer
  JWKS mechanism at all).
- ORY Hydra (+ Kratos) provides no federation-in mechanism of any kind, confirmed by Ory's own current
  documentation — adopting it here would mean hand-building the entire bridge, the same category of
  security-critical custom code this repo's own ADR 0013 already rejected for a much narrower problem.
- Kanidm has no relevant mechanism at all.
- A structural, sourced constraint applies to every viable candidate equally: Kubernetes' own
  ServiceAccountIssuerDiscovery feature is reachable cross-cluster only via a deliberate admin action or a
  separately-hosted mirror, and this research could not confirm whether Omni's WireGuard-only proxy (ADR 0011) carries that traffic — a broker genuinely collapses the _outward_ consumer-side fan-out, but does not
  by itself resolve the _inward_ per-cluster reachability question #54 already flagged for other mechanisms.

---

## Sources

**Dex**

- Dex Enhancement Proposal (DEP) 2812, Token Exchange — <https://github.com/dexidp/dex/blob/master/docs/enhancements/token-exchange-2023-02-03-%232812.md>
- PR #2806 "RFC 8693 OAuth 2.0 Token Exchange" (merged 2023-07-01) — <https://github.com/dexidp/dex/pull/2806>
- Dex v2.38.0 release notes — <https://github.com/dexidp/dex/releases/tag/v2.38.0>
- `server/grants/tokenexchange.go` — <https://github.com/dexidp/dex/blob/master/server/grants/tokenexchange.go>
- `server/grants/grants.go` (request parsing, no `resource` param) — <https://github.com/dexidp/dex/blob/master/server/grants/grants.go>
- `server/config.go` (`supportedTypes`, default-enabled grants) — <https://github.com/dexidp/dex/blob/master/server/config.go>
- `server/tokens/claims.go` (`GetAudience`) — <https://github.com/dexidp/dex/blob/master/server/tokens/claims.go>
- `connector/connector.go` (`TokenIdentityConnector` interface) — <https://github.com/dexidp/dex/blob/master/connector/connector.go>
- `connector/oidc/oidc.go` (`TokenIdentity`, `SkipClientIDCheck`, `Config` struct, `Open()`) — <https://github.com/dexidp/dex/blob/master/connector/oidc/oidc.go>
- Dex releases index — <https://github.com/dexidp/dex/releases>

**authentik**

- Token exchange — <https://github.com/goauthentik/authentik/blob/main/website/docs/add-secure-apps/providers/oauth2/token_exchange.md>
- Machine-to-Machine (M2M) authentication (Kubernetes service account tokens worked example) — <https://github.com/goauthentik/authentik/blob/main/website/docs/add-secure-apps/providers/oauth2/machine_to_machine.mdx>
- OAuth source (JWKS machine-to-machine trust) — <https://github.com/goauthentik/authentik/blob/main/website/docs/users-sources/sources/protocols/oauth/index.mdx>
- `authentik/providers/oauth2/token/token_exchange.py` — <https://github.com/goauthentik/authentik/blob/main/authentik/providers/oauth2/token/token_exchange.py>
- `authentik/providers/oauth2/token/base_fed.py` (`validate_jwt_from_source`, `create_user_from_jwt`) — <https://github.com/goauthentik/authentik/blob/main/authentik/providers/oauth2/token/base_fed.py>
- PR #12083 "Add provider federation between OAuth2 Providers" (merged 2024-12-03) — <https://github.com/goauthentik/authentik/pull/12083>
- PR #23900 "providers/oauth2: token exchange" (merged 2026-07-10) — <https://github.com/goauthentik/authentik/pull/23900>
- PR #24356 "providers/oauth2: token exchange delegation" (merged 2026-08-04) — <https://github.com/goauthentik/authentik/pull/24356>
- authentik releases (release-candidate status at research time) — <https://github.com/goauthentik/authentik/releases>

**Pocket ID**

- OIDC Client Authentication / Federated Client Credentials — <https://github.com/pocket-id/website/blob/main/docs/guides/oidc-client-authentication.md>
- `backend/internal/oidc/federated_client_auth.go` — <https://github.com/pocket-id/pocket-id/blob/main/backend/internal/oidc/federated_client_auth.go>

**Authelia**

- OpenID Connect 1.0 Clients (`jwks_uri`, `token_endpoint_auth_method`, `grant_types`) — <https://github.com/authelia/authelia/blob/master/docs/content/configuration/identity-providers/openid-connect/clients.md>
- `internal/oidc/client_credentials.go` — <https://github.com/authelia/authelia/blob/master/internal/oidc/client_credentials.go>

**Keycloak**

- Server Administration Guide (Identity Broker overview, OpenID Connect v1.0 identity providers) — <https://www.keycloak.org/docs/latest/server_admin/index.html>
- Token Exchange (Standard V2 vs. Legacy V1, `subject_issuer`, deprecation status) — <https://www.keycloak.org/securing-apps/token-exchange>

**ZITADEL**

- OAuth 2.0 Token Exchange (RFC 8693): Impersonation & Delegation — <https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/token-exchange.mdx>
- JWT IdP — <https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/identity-providers/jwt_idp.mdx>
- Private Key JWT Auth for Service Accounts — <https://github.com/zitadel/zitadel/blob/main/apps/docs/content/guides/integrate/service-accounts/private-key-jwt.mdx>
- OAuth2 concepts (grant types) — <https://www.zitadel.com/docs/apis/openidoauth/grant-types>

**Casdoor**

- `object/token_oauth_util.go` (`ValidateClientAssertion`, `ValidateJwtAssertion`, `parseAndValidateSubjectToken`) — <https://github.com/casdoor/casdoor/blob/master/object/token_oauth_util.go>
- `object/cert.go` (`Cert` struct) — <https://github.com/casdoor/casdoor/blob/master/object/cert.go>
- `controllers/token.go` — <https://github.com/casdoor/casdoor/blob/master/controllers/token.go>

**ORY Hydra / Kratos**

- Ory's own `llms.txt` (first-party agent-facing product guidance) — <https://www.ory.com/llms.txt>
- OAuth2 concepts (grant types Hydra supports) — <https://www.ory.com/docs/hydra/concepts/oauth2>
- Login and consent flow — <https://www.ory.com/docs/hydra/guides/login>
- Hydra OpenAPI spec (`spec/api.json`, token endpoint schema) — <https://github.com/ory/hydra/blob/master/spec/api.json>
- Kratos: Social sign-in / OIDC — <https://www.ory.com/docs/kratos/social-signin/overview>

**Kanidm**

- OAuth2 integration docs — <https://github.com/kanidm/kanidm/blob/master/book/src/integrations/oauth2.md>

**Other candidates noted but not deep-dived**

- Ory Talos (Macaroon-based non-human-identity product, different mechanism entirely) — <https://www.ory.com/talos>
- Teleport (bastion/PAM platform with SPIFFE-adjacent Workload Identity; not verified against this ticket's specific pattern) — <https://github.com/gravitational/teleport>

**Kubernetes / Cloudflare (shared, cross-candidate mechanics)**

- Configure Service Accounts for Pods — ServiceAccount issuer discovery (stable since v1.21, default RBAC scope) — <https://kubernetes.io/docs/tasks/configure-pod-container/configure-service-account/>
- Cloudflare Tunnel: Routing (public-hostname-to-local-service mapping) — <https://developers.cloudflare.com/tunnel/routing/>
- OpenBao JWT/OIDC Auth Method (API reference, `bound_audiences` optionality) — <https://openbao.org/docs/api/auth/jwt/>

**catalyst repo (current-state context, not re-derived here)**

- `docs/research/machine-identity-research.md` (branch `research/machine-identity-research`) — prior SPIFFE/SPIRE, Istio-ambient, OpenBao auth-method, IRSA, and cloud-prior-art findings, treated as fixed
- `docs/research/identity-research.md` (branch `research/identity-research`) — prior human-IdP passkey/invite-flow findings for Pocket ID, Authentik, Zitadel, Kanidm, Keycloak, Authelia, treated as fixed except where this document adds the new machine-identity angle
- `irsa.md` — this repo's existing self-hosted IRSA pattern
- `docs/adr/0004-secrets-management-openbao.md` — OpenBao decision, platform-cluster placement
- `docs/adr/0009-ingress-istio-no-mesh-span.md` — independent per-cluster root CAs, no mesh span
- `docs/adr/0011-cluster-registration-cross-cluster-auth.md` — Omni WireGuard-only cross-cluster reachability; Omni's own bundled Dex (used only for Omni's own UI login, a separate concern from this ticket)
- `docs/adr/0013-oidc-forward-auth-istio-authservice-waypoint.md` — this repo's own precedent for rejecting hand-rolled OIDC RP code
- `docs/forward-auth.md` — existing Pocket ID / `withOidcAuth()` integration this repo already operates
- catalyst repo issues consulted: [#1](https://github.com/aaronkyriesenbach/catalyst/issues/1) (wayfinder map), [#13](https://github.com/aaronkyriesenbach/catalyst/issues/13) (human IdP, resolved/deferred), [#19](https://github.com/aaronkyriesenbach/catalyst/issues/19) (Cloudflare Tunnel adoption, resolved), [#54](https://github.com/aaronkyriesenbach/catalyst/issues/54) (machine-identity research), [#55](https://github.com/aaronkyriesenbach/catalyst/issues/55) (grilling ticket this research feeds)
