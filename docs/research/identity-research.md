# Research: Human identity-provider alternatives to Pocket ID

Ticket: [aaronkyriesenbach/catalyst#12](https://github.com/aaronkyriesenbach/catalyst/issues/12), part of the "Homelab platform rearchitecture" wayfinder map ([#1](https://github.com/aaronkyriesenbach/catalyst/issues/1)).

## Question

Survey human identity-provider alternatives to Pocket ID, evaluating Pocket ID itself
holistically rather than assuming it's kept. Hard requirements: **passkey support**,
**email-based invite flow**. Context: single-operator homelab, free-tier-first-but-cheap-is-fine-with-justification.

## Current state in the repo

`apps/pocket-id.ts` deploys Pocket ID via the third-party
[`pocket-id-operator`](https://github.com/aclerici38/pocket-id-operator) Helm chart
(`oci://ghcr.io/aclerici38/charts/pocket-id-operator`, chart `0.7.2`), which manages
Pocket ID declaratively via CRDs (`PocketIDUserGroup`, `PocketIDOIDCClient`).
`apps/pocket-id/values.yaml` pins the app image to `ghcr.io/pocket-id/pocket-id:v2.8.0`,
with `userManagement.allowUserSignups: "disabled"`, SQLite-backed persistence on
`truenas-iscsi`, and routes on both `traefik-external`/`traefik-internal` gateways at
`auth.lab53.net`. Per `docs/forward-auth.md`, the `withOidcAuth()` modifier uses this
operator to auto-provision an OIDC client + user group + (optionally) Traefik forward-auth
middleware for every app that wants SSO — this is a meaningful amount of custom
integration glue that any replacement would need to reproduce or re-plumb.

The upstream changelog (see below) shows the project is currently on `v2.13.0`; the
deployed `v2.8.0` is several minor releases behind, so a "keep Pocket ID" outcome should
also include an upgrade.

## Pocket ID (current provider)

Source: [pocket-id/pocket-id README](https://github.com/pocket-id/pocket-id) (GitHub, retrieved live),
[pocket-id/website docs](https://github.com/pocket-id/website) (`docs/introduction.md`,
`docs/guides/sign-in-methods.md`, `docs/setup/user-management.md`,
`docs/configuration/environment-variables.md`, `docs/configuration/ldap.md`,
`docs/configuration/scim.md`, `docs/changelog.md`).

- **What it is**: "an easy-to-use OpenID Connect Certified™ and OAuth 2.0 provider that
  lets users sign in to your applications with passkeys" — README, pocket-id/pocket-id.
  It is intentionally scoped down versus Keycloak/ORY Hydra: "Pocket ID is special [...]
  it only supports passkey authentication" (README).
- **Passkeys**: native and the *only* first-class credential type; configurable via
  `WEBAUTHN_USER_VERIFICATION`, `WEBAUTHN_ALLOW_SYNCED_PASSKEYS`,
  `WEBAUTHN_AUTHENTICATOR_ATTACHMENT` (`docs/configuration/environment-variables.md`).
  Fallback sign-in methods (admin-generated login code, "sign in with another device"
  QR/cross-device flow, optional insecure email one-time-code) are documented in
  `docs/guides/sign-in-methods.md`.
- **Email-based invite flow — partial, not fully automated**:
  - `docs/setup/user-management.md` documents three ways to get a new user onto a passkey:
    1. **Login Code** — admin generates a link from the Users page (or CLI
       `pocket-id one-time-access-token <user>`) and must manually hand it to the user
       through some out-of-band channel; Pocket ID does not send this itself.
    2. **One-Time Access Email** — requires SMTP configured, but this is *user-initiated
       self-service* ("Don't have access to your passkey?" → user enters their own
       email); it's not an admin-driven invite, and the docs explicitly flag it as
       reducing security ("anyone with access to the user's email can gain entry").
    3. **Signup Tokens** (since [v1.5.0](https://github.com/pocket-id/pocket-id/pull/672)) —
       an admin creates a shareable signup-token link (with expiry/use-limit) that lets a
       new user self-register and set up their first passkey. Again, Pocket ID does not
       email this link on the admin's behalf; the admin must copy/paste and send it
       themselves.
  - Net: Pocket ID has all the *building blocks* for an invite flow (SMTP config,
    tokenized links, one-time codes) but **no built-in "type an email address, click
    Invite, user gets an email automatically" feature**. This is the clearest gap versus
    the hard requirement as commonly understood.
- **Other capabilities**: LDAP sync (read-only mirror of an external directory —
  `docs/configuration/ldap.md`), SCIM provisioning to downstream clients
  (`docs/configuration/scim.md`), allowed-group-based per-client access control,
  OpenTelemetry/Prometheus observability, OpenID Connect Certified™ badge (README).
- **Operational footprint**: single Go binary + SQLite/Postgres, currently the lightest
  of all options surveyed here; already deployed and integrated with a bespoke operator.

## Authentik

Source: [goauthentik/authentik](https://github.com/goauthentik/authentik) docs
(`website/docs/add-secure-apps/flows-stages/stages/authenticator_webauthn/index.md`,
`.../stages/invitation/index.md`, `.../stages/email/index.md`).

- **Passkeys**: first-class via the **WebAuthn / FIDO2 / Passkeys authenticator setup
  stage**, which "enrolls a WebAuthn authenticator for the current user," supports
  security keys, platform authenticators (Windows Hello/Touch ID/Face ID), and
  "passkeys stored by operating systems or password managers." Discoverable-credential
  (true passkey, passwordless) behavior is explicit config: "For passkey-based
  passwordless login, set Resident key requirement to Preferred or Required."
- **Email-based invite flow — yes, and fully composable**: Authentik ships a dedicated
  **Invitation stage** ("used to invite users to enroll in authentik... typically used
  in enrollment flows where users should only be allowed to continue if they were
  invited by an administrator") that gates an enrollment flow with a token
  (`?itoken=...`), plus a separate **Email stage** that "sends a verification or action
  email from within a flow" and is explicitly documented for "email verification,
  account recovery, invitations, and similar flow steps where authentik should send a
  tokenized link." Combining Invitation + Email + WebAuthn stages in one enrollment flow
  gives exactly "admin creates invite → user gets an email → user sets up a passkey,"
  which is Authentik's designed flow-builder pattern, not a bolt-on.
- **Trade-offs**: Authentik's power comes from its flow/stage system, which is more
  configuration surface than Pocket ID or Zitadel's turnkey "create user + send
  invite" button — you assemble the enrollment flow yourself (or use a bundled default
  and customize it). Heavier footprint than Pocket ID (Python/Django + Celery worker +
  Redis + Postgres, per Authentik's own deployment docs), which matters for a
  single-operator homelab's maintenance budget even though it's still free/OSS.

## Keycloak

Source: [keycloak.org server admin guide](https://www.keycloak.org/docs/latest/server_admin/index.html)
and [Keycloak REST API reference](https://www.keycloak.org/docs-api/latest/rest-api/index.html)
(both official, retrieved live).

- **Passkeys**: dedicated sections in the server admin guide's authentication chapter —
  "W3C Web Authentication (WebAuthn)," "Passwordless WebAuthn together with Two-Factor,"
  "LoginLess WebAuthn," and a distinct **"Passkeys"** subsection covering "Passkey
  Authentication with Conditional UI or autofill," "Passkeys Authentication with Modal
  UI," and "Passkey Mediation." Keycloak has supported WebAuthn passwordless flows
  since well before passkeys were branded as such, and has since added explicit passkey
  (conditional UI / autofill) support.
- **Email-based invite flow — yes, via required actions + admin API**: Keycloak's
  invite mechanism is the **"required actions" + execute-actions email** pattern. The
  REST API `PUT /admin/realms/{realm}/users/{user-id}/execute-actions-email`
  ("Send an email to the user with a link they can click to execute particular
  actions... An email contains a link the user can click to perform a set of required
  actions") lets an admin create a user then immediately email them a link that forces
  them to complete required actions such as `UPDATE_PASSWORD`, `VERIFY_EMAIL`, or the
  WebAuthn/passwordless registration action, before they can log in. This is reachable
  from the Admin Console (Users → Credentials → "Send email") as well as the REST/Admin
  Client API, so no external tooling is required — but it's an admin-facing multi-step
  action, not a single "Invite" button with a dedicated invite object like Zitadel's.
- **Trade-offs**: Keycloak is the most mature/feature-complete option (also OIDC and
  SAML), but has the heaviest operational footprint of the group (JVM, realm/DB
  management, admin console complexity) — commonly cited as "too complex for simple use
  cases," which is literally why Pocket ID's own README positions itself as the
  antidote to Keycloak. For a single operator this is a real cost, justified only if the
  extra protocol/feature surface (SAML, fine-grained authZ, client policies) is needed.

## Zitadel

Source: [zitadel/zitadel](https://github.com/zitadel/zitadel) docs
(`apps/docs/content/concepts/features/passkeys.mdx`,
`apps/docs/content/guides/manage/user/reg-create-user.mdx`,
`apps/docs/content/guides/integrate/onboarding/end-users.mdx`,
`apps/docs/content/guides/manage/console/_create-user.mdx`).

- **Passkeys**: first-class product feature — "ZITADEL's passkeys feature enables
  passwordless authentication... FIDO2 passkeys," self-service management ("Users
  manage their passkeys directly through ZITADEL's self-service portal"), and explicit
  developer APIs to request a passkey-registration link for a user
  (`request_passwordless_registration`) or add a passkey to an existing user.
- **Email-based invite flow — yes, first-class, admin-console native**: The console's
  "New User" flow (`_create-user.mdx`) has an explicit invite option: **"Send an
  invitation E-Mail for authentication setup and E-Mail verification: The user will
  receive an email and be able to setup an authentication method (e.g Password,
  Passkey, External SSO)."** This is a checkbox in the standard "create user" UI, not a
  separate feature to bolt on — closest match to "type email, click invite, get
  emailed" of everything surveyed. The API layer additionally supports directly emailing
  a passkey-registration link ("Send Passkey Registration") to an existing user.
- **Trade-offs**: Zitadel is a full multi-tenant IAM platform (organizations, projects,
  service accounts, SCIM, actions/hooks) — more product than a single-operator homelab
  strictly needs, and it's primarily built around a Postgres-backed event-sourced
  architecture (heavier than Pocket ID, lighter than Keycloak). It has a hosted
  free-tier SaaS and a fully open-source self-hosted path (AGPL-licensed core per its
  `LICENSE`/`LICENSING.md`), so self-hosting remains free; the main cost is operational
  complexity, not license fees.

## Kanidm

Source: [kanidm/kanidm](https://github.com/kanidm/kanidm) docs
(`book/src/accounts/authentication_and_credentials.md`, `book/src/accounts/people_accounts.md`,
`book/src/email_setup.md`, `book/src/integrations/oauth2.md`).

- **Passkeys**: Kanidm treats passkeys as its preferred, primary credential type —
  "This is the preferred method of authentication in Kanidm... considered the most
  secure method of authentication in Kanidm" — with an additional "Attested Passkeys"
  tier for enforcing specific authenticator models via account policy. Kanidm is
  strongly opinionated toward passwordless/passkey-first design, similar in spirit to
  Pocket ID but built around a from-scratch identity-management data model (persons,
  groups, service accounts, POSIX/LDAP compatibility) rather than "just OIDC."
- **Email-based invite flow — partial, and requires an extra service**: onboarding uses
  `kanidm person credential create-reset-token <account>`, which produces a link/QR
  code for the admin to deliver "so that they can directly enroll their own
  credentials" — the docs don't show this command auto-emailing the link. Kanidm does
  have first-party outgoing email support (`book/src/email_setup.md`), but it is
  deliberately decoupled: "`kanidmd` itself does not send the messages, but relies on
  an external tool, `kanidm-mail-sender`, to process the mail queue" — a separate
  service/service-account/API-token you must stand up and run continuously. Kanidm also
  documents self-service **account recovery** by email ("users will be able to follow
  the account recovery link from the login page and have a credential reset link sent
  to their email"), but that's recovery for existing accounts, not new-user invitation.
  Net: achievable, but it is the most DIY of the options that have *any* email story,
  and needs a second long-running component beyond the core server.
- **OIDC**: Kanidm is a functioning OAuth2/OIDC provider (`book/src/integrations/oauth2.md`),
  though the project historically emphasizes it as one integration point among several
  (LDAP, RADIUS, POSIX) rather than its primary identity, unlike Pocket ID/Zitadel.

## Authelia — disqualified on hard requirements

Source: [authelia/authelia](https://github.com/authelia/authelia) docs
(`docs/content/reference/guides/webauthn.md`, `docs/content/overview/authentication/first-factor/index.md`).

- **Passkeys**: supported and reasonably mature — Authelia documents a NIST-compliant
  recommended passkey configuration (`webauthn.enable_passkey_login: true`,
  `attestation_conveyance_preference: direct`, metadata trust validation), so the
  passkey requirement alone is satisfiable.
- **Email-based invite flow: not available.** Authelia is explicit that it has no
  built-in user directory of its own: *"Authelia utilizes the standard username and
  password combination for first factor authentication... Authelia supports several
  kind of user databases: An LDAP server... A YAML file"* — user creation and any
  invite/onboarding UX must come from whatever backs that YAML file or LDAP server
  (e.g., a separate lldap/OpenLDAP deployment), not from Authelia itself. Since none of
  Authelia's supported user-database backends are themselves invite-flow-capable out of
  the box, adopting Authelia would mean building (or separately adopting) an entirely
  different user-directory product just to get the invite requirement, on top of
  Authelia for the auth/2FA layer. This makes it a poor fit as a single self-hostable
  OIDC provider for this use case, even though it's excellent as a forward-auth/2FA
  layer in front of another IdP.

## Comparison summary

| Provider   | Passkey support                          | Native email invite flow                                  | Footprint (single operator) | OIDC |
|------------|-------------------------------------------|-------------------------------------------------------------|------------------------------|------|
| Pocket ID  | Yes, primary/only credential              | No — admin-generated links/tokens only, manual delivery     | Lightest (deployed today)   | Yes, OIDC Certified |
| Authentik  | Yes, via WebAuthn stage                   | Yes — Invitation + Email stages composable in enrollment flow | Heavy (Django/Celery/Redis/Postgres) | Yes |
| Keycloak   | Yes, incl. passkey conditional UI          | Yes — `execute-actions-email` API / Admin Console           | Heaviest (JVM)               | Yes, + SAML |
| Zitadel    | Yes, first-class self-service              | Yes — "Send invitation E-Mail" checkbox on user creation     | Moderate-heavy (Postgres, event-sourced) | Yes |
| Kanidm     | Yes, preferred credential type             | Partial — reset-token links + separate mail-sender service required | Moderate (Rust binary + mail-sender) | Yes |
| Authelia   | Yes                                        | No — no built-in user directory at all                       | Light (but needs external user store) | Yes |

## Recommendation

Pocket ID fails the "email-based invite flow" requirement as commonly understood (an
admin enters an email address and the invitee automatically receives an email to set up
their account/passkey) — everything it offers (login codes, signup tokens, one-time
access email) requires the admin to manually distribute a link rather than the system
sending an invite on the admin's behalf. For a single-operator homelab where invites are
probably rare (a handful of family/friends, occasionally), this gap is real but low-
frequency: it is a one-time manual copy/paste per invite, not a recurring operational
burden.

Given the single-operator, keep-it-simple context:

- If the manual-link workflow is acceptable in practice (it likely is, for occasional
  invites), **staying on Pocket ID and upgrading `v2.8.0` → `v2.13.0`** preserves the
  existing bespoke `pocket-id-operator` CRD integration (`withOidcAuth()`,
  `PocketIDUserGroup`/`PocketIDOIDCClient`) described in `docs/forward-auth.md`, which
  is nontrivial to replicate elsewhere, and keeps the lightest possible footprint.
- If a true one-click "type email → they get invited automatically" flow is a hard
  requirement rather than a nice-to-have, **Zitadel** is the closest drop-in match: its
  standard "create user" UI has a first-class "send invitation e-mail" option that
  directly supports passkey setup, at the cost of adopting a heavier, more
  feature-rich IAM platform than this homelab strictly needs, and losing the existing
  operator integration (would need a new OIDC-client-provisioning mechanism, e.g. its
  own Terraform provider or API automation).
- **Authentik** is the best fallback if Zitadel's platform scope feels like overkill but
  Pocket ID's manual-invite gap is unacceptable — its Invitation + Email + WebAuthn
  stages give equivalent capability with a more "assemble it yourself" flow builder, at
  a real but moderate increase in operational footprint versus Pocket ID.
- **Keycloak** is only justified if SAML or enterprise-grade IAM features become a
  requirement — its complexity is disproportionate to a single-operator homelab.
- **Kanidm** is interesting philosophically (passkey-first, Rust, low CVE surface) but
  its invite/email story is the least turnkey of the providers that have one at all,
  requiring a second always-on service; not recommended purely for the invite
  requirement.
- **Authelia** should be ruled out as a Pocket-ID replacement for this ticket's
  requirements — it isn't a user directory and has no invite mechanism of its own.
