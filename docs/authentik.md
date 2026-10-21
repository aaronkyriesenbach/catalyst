# authentik

Identity provider for the cluster. It replaces Pocket ID app by app; see [forward-auth.md](forward-auth.md) for the migration state.

## Layout

| Path                                  | Purpose                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/authentik.ts`                   | Helm release, Postgres, secrets, route, `ReferenceGrant`, blueprint ConfigMap    |
| `apps/authentik/values.yaml`          | Chart values (env from secrets, 2 server replicas, PDB)                          |
| `apps/authentik/blueprint.ts`         | Generates the `catalyst-apps` blueprint and the per-app client-secret blueprints |
| `apps/authentik/users.config.ts`      | Users enforced from Git                                                          |
| `apps/authentik/recovery-flow.yaml`   | Password recovery flow, also used to email a user a set-password link            |
| `apps/authentik/enrollment-flow.yaml` | Invitation-only enrollment flow                                                  |
| `auth.ts`                             | authentik URL, forward-auth Middleware, issuer helper                            |

The hostname is `authentikHostOptions` in `auth.ts`: `authentik.lab53.net`, externally accessible because public apps send their users to it, so the route gets the default WAF profile (its `crowdsec-appsec` Middleware is emitted by `apps/authentik.ts`). To move to `auth.lab53.net`, set `subDomain` to `"auth"` in the same change that removes Pocket ID, which holds that name today. Everything generated from it (provider URLs, the outpost host, each app's issuer) follows.

## One-time setup

1. **SMTP.** Create SES SMTP credentials (SES console, SMTP settings). These are derived credentials, not the IAM access key `apprise` uses. Store them in AWS Secrets Manager as `lab53/cluster0/authentik/smtp-credentials` with the properties `host` (e.g. `email-smtp.us-east-1.amazonaws.com`), `username`, `password` and `from` (any address at the verified `lab53.net` domain). authentik starts without it, but recovery and invitation emails fail until it exists. Reloader only reacts to changes, not to an optional secret appearing for the first time, so after creating it run `kubectl -n authentik rollout restart deploy/authentik-server deploy/authentik-worker`. Without that the server keeps authentik's default sender (`authentik@localhost`), which SES rejects as unverified; later changes to the secret restart both automatically.
2. **Break-glass admin.** On first start authentik creates `akadmin` with the generated password at `lab53/cluster0/authentik/authentik-bootstrap-password` (property `password`). It is only read on the first start.
3. **Your own login.** Your user is declared in `users.config.ts` without a password or an email, because the repo is public. As `akadmin`, open Directory, Users, your user, set the email, and choose **Email recovery link**.

## Users

Users in `users.config.ts` are enforced from Git: `name` and group memberships are rewritten on every apply, and so is `email` when the entry sets one. Leave `email` unset to keep addresses out of the public repo and set it in the UI; the blueprint then never touches it. `groups` is a complete set, so memberships added to a declared user in the UI are reverted. Passwords are never touched. `admin: true` adds the user to authentik's `authentik Admins` group (authentik superuser). `apps` lists the apps the user may open, each of which must declare `oidc` or the render fails, or is `"all"` for every app that does, so new apps are granted automatically. `groups` lists extra groups from the `groups` array in the same file. Those exist for apps that read a group claim and are kept apart from authentik's own admin group: shakedown's `ADMIN_GROUP` is `admin`, for example. The names must not clash with an app or a built-in group.

Everyone else is created in authentik and never appears in Git:

1. In the admin UI create an invitation (Directory, Invitations) for the `enrollment-invitation` flow, then email it from there, or call `POST /api/v3/stages/invitation/invitations/<uuid>/send_email/`. authentik does not email automatically when an invitation is created, and invitations themselves are runtime objects, not declarable.
2. The invitee sets a username, password, name and email. They land in the `users` group, which grants no app access.
3. Grant access by adding them to the app's group in the UI. Blueprints never remove members they didn't add, so these memberships persist.

## Blueprints

authentik applies YAML blueprints from `/blueprints`. This app mounts one ConfigMap (`authentik-blueprints`) and one Secret per OIDC client:

- `catalyst-apps.yaml`: generated. For every app that declares `oidc` it creates a group, a provider, an application and a policy binding limiting the application to the group. It binds all proxy providers to the embedded outpost and applies the declared users.
- `recovery-flow.yaml`, `enrollment-flow.yaml`: static flows, kept separate because a blueprint with any failing entry is rolled back as a whole.

Things that behave differently than you might expect (all confirmed against authentik 2026.8.4):

- **First-boot ordering.** Blueprints apply in no fixed order, so each one starts with `metaapplyblueprint` entries naming the built-in blueprints it looks things up in.
- **The outpost entry is a full set.** Every proxy provider must be in the one `authentik_outposts.outpost` entry, and `config` replaces the whole config, with `authentik_host` mandatory.
- **Unchanged files are skipped.** authentik re-applies a blueprint only when the file's hash changes. A value read with `!File` or `!Env` doesn't count, which is why client secrets are rendered into a blueprint file (below).
- **Failures.** A bad entry fails the whole blueprint (status `error`, nothing applied). Check Customization, Blueprints in the admin UI, or the worker logs for `Blueprint invalid`.
- **Editors.** `!KeyOf` and `!Find` are authentik tags, so generic YAML tooling reports them as unresolved. Registering them as custom tags (see authentik's blueprint docs) silences that.

## Client secrets and rotation

Apps that run their own OIDC flow use `withOidcClient({ redirectPaths })`. Forward-auth apps need no secret.

1. `apps/authentik.ts` generates the secret (48 characters) and stores it in AWS at `lab53/cluster0/authentik/oidc-<app>` (property `client_secret`). Every 90 days (`DEFAULT_CLIENT_SECRET_ROTATION`) ESO generates a new value and overwrites it.
2. In the `authentik` namespace an ExternalSecret renders the value into a small blueprint (`client-secret.yaml`) that sets only the provider's `client_secret`. The chart mounts it through `blueprints.secrets`. Because the secret is part of the file, a rotation changes its hash and authentik re-applies it.
3. In the app's namespace `withOidcClient` creates `<app>-oidc-credentials` with `client_id`, `client_secret` and `issuer_url` from the same AWS key.
4. Both ExternalSecrets re-read every minute, and Reloader restarts the app and the authentik worker when their secret changes.

authentik allows one secret per provider, so for a minute or two after a rotation the two sides can disagree and token exchanges (new logins and token refreshes) fail until both converge. Established sessions aren't affected. Rotation is interval-based, so its time of day is arbitrary. `buildSeedPushSecret` has a TODO to move to a cron schedule once external-secrets supports it.

## First boot

Expect about 10 minutes from a fresh install until forward auth works. The pods are Ready after roughly 3 minutes of database migrations. `catalyst-apps` then waits for authentik's built-in blueprints, which takes several more minutes, and the embedded outpost loads its provider list about 30 seconds after that. Until then protected apps return a 404 from authentik. The `authentik` Argo app also stays Degraded while the `authentik-smtp` ExternalSecret has no AWS secret to read.

## Verified on the cluster

Forward auth for reader through Traefik (login redirect, the `/outpost.goauthentik.io/` route across namespaces through the `ReferenceGrant`, and the Middleware), blueprint application, per-app group access (a member passes, a superuser outside the group is denied), secret seeding, and the rotation chain: `PushSecret` regenerates and overwrites the AWS value on its interval, the consumer ExternalSecret picks it up within a minute, and Reloader restarts the workload.

## Not verified yet

- SES delivery of recovery and invitation emails (needs the SMTP secret).
- A browser login completing end to end (the declared user has no password until the recovery email is sent).
- A rotation reaching authentik itself: the pieces are tested separately, but not with a real `withOidcClient` app.
- The Cloudflare tunnel path, which matters for externally accessible apps (reader is internal).

ESO's AWS user cannot delete secrets, so a deleted `PushSecret` leaves its AWS secret behind. The seeds use `deletionPolicy: None` for the same reason, and removing an app's secret is a manual step in AWS.
