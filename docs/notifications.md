# Notification Stack

A flexible, cluster-wide notification system: **push + email, reusable by any
service** (not just the cert-deploy jobs). Status: **implemented** (`apps/apprise.ts`,
`apps/healthchecks.ts`, wired into `apps/external-cert-deployer.ts`); the manual
setup steps are under [Manual setup](#manual-setup).

Push is delivered via **Pushover** (a hosted relay), not a self-hosted push
server. The rationale — and why it matters specifically for infra alerts — is in
[Design rationale](#design-rationale-why-a-hosted-relay-not-self-hosted-push).

## Goals

- **Push** notifications to phone (iOS + Android).
- **Email** notifications.
- **Reusable** — any cluster service emits notifications the same way; adding a
  new channel (Discord/Telegram/SMS) must not touch every service.
- **Designed for future observability** — when a metrics stack lands later,
  Alertmanager plugs into the same gateway with no rework.

## Architecture

```text
any service ──POST /notify/{key} {title,body,tag}──┐
cert-deploy CronJob ─(on failure)─────────────────┤
(future) Alertmanager ─(webhook)──────────────────┤
                                                   ▼
                                            Apprise API (gateway, internal-only)
                                       tag routing: push / email / critical
                                          │                     │
                                   pover:// │                     │ ses://
                                          ▼                     ▼
                                    Pushover cloud ──push──> phone (iOS/Android)
                                                          AWS SES ──> inbox

cert-deploy CronJob ──(on success) ping──> Healthchecks ──(missed ping)──> Apprise
```

Three external/vendor channels behind one gateway: **Apprise** (gateway),
**Pushover** (push), **AWS SES** (email), plus **Healthchecks**
(dead-man-switch). Rationale for each below.

**Key property:** every delivery path is **outbound-only**. Apprise POSTs to
`api.pushover.net` and to AWS SES; nothing in this stack requires an
internet-exposed endpoint on the cluster. See the design rationale for why that
is the whole point.

## 1. Apprise API — the universal gateway

The reusable layer. `caronc/apprise` (the API server is in the same image),
deployed as a `WorkloadApp`, **internal-only** (no external route).

- Services POST **once** to a stored config key and Apprise fans out to every
  configured channel. They never need to know the Pushover/SES URLs or creds.
- **Tag routing** lets one POST target a subset of channels — `push`, `email`,
  `critical`, etc. This is what makes it reusable: a new service just POSTs with
  a tag; adding Discord later touches **only** the Apprise config.

### API

- **Stateless**: `POST /notify` with `urls` in the body.
- **Stateful** (preferred): store config under a key, then
  `POST /notify/{key}` with `{title, body, type, tag}`. The key is the **name of
  the notifying app** (e.g. `external-cert-deployer`).
- Config management (`POST /add/{key}`, `GET /get/{key}`, `POST /del/{key}`) is
  **disabled in our deploy** (`APPRISE_CONFIG_LOCK=yes`) — config is file-seeded,
  read-only. Only `/notify/{key}` is live. See §1 "Security model".
- Health: `GET /status`; metrics at `/metrics`.

```bash
# Send: tag selects endpoints; space = AND, comma = OR (config is pre-seeded)
curl -X POST http://apprise.apprise.svc:8000/notify/external-cert-deployer \
  -H 'Content-Type: application/json' \
  -d '{"title":"Disk full","body":"/var 98%","type":"warning","tag":"warn"}'
```

The per-service config file (pre-seeded into `/config/external-cert-deployer.yml`
from AWS Secrets Manager) defines the tag routing. Simple stateful mode only
reads `.yml`/`.cfg`, never `.yaml`. The checked-in template is
`apps/apprise/notifier.yml`; its shape is:

```yaml
version: 1
urls:
    - pover://USER_KEY@APP_TOKEN?priority=normal:
          - tag: info, push
    - pover://USER_KEY@APP_TOKEN?priority=high:
          - tag: warn, critical, push
    - pover://USER_KEY@APP_TOKEN?priority=emergency&interval=300&expire=10800:
          - tag: emergency, push
    - ses://FROM/ACCESS_KEY/SECRET_KEY/REGION/TO:
          - tag: critical, emergency, email
```

A URL's tags are a **set**, so a request is matched by any tag the URL carries:
`tag=critical` hits Pushover (high) and SES, `tag=critical email` (AND) hits
SES only, and `tag=info` hits Pushover (normal) only. A tag that matches no URL
returns HTTP 424.

### K8s deploy

- Image `caronc/apprise` (pinned in `versions.ts`), port 8000, in-cluster URL
  `http://apprise.apprise.svc:8000`.
- `WorkloadApp` with **no `webPort`**, so only a ClusterIP Service exists: no
  HTTPRoute at all, not even on the internal gateway (the LAN could otherwise
  send notifications).
- Runs as uid 1000 with a read-only root filesystem; `/tmp` is an `emptyDir` and
  `/config` is the rendered Secret, mounted read-only.
- `APPRISE_STORAGE_DIR=""` and `APPRISE_ATTACH_SIZE=0` keep `/status` healthy
  with no writable `/config` or `/attach`.
- `appriseNotifiers` in `apps/apprise.ts` lists the notifying apps; each gets
  its own `<app>.yml`. Add a name there to onboard a new service.

### Security model (finalized)

Apprise has **no authentication on any endpoint — by design** (apprise-api
README: _"There is no authentication... this is by design"_). A `/notify/{key}`
path segment is a **routing selector, not a credential**: anyone who can reach
the server can send, and keys are plain app names, so they are trivially
guessable. We deliberately do not obscure them: the worst case is a compromised
pod sending us notifications, which is a minor problem. Apprise cannot provide per-key auth, OIDC
forward-auth is browser-shaped (wrong for machine calls), and there is no service
mesh for mTLS _yet_ (planned — see [Future implementation](#future-implementation)).
So until the mesh lands, the boundary is **network reachability**: the service is
internal-only and unreachable from outside the cluster.

Controls applied now (defense in depth):

1. **Internal-only** — ClusterIP Service, no external Gateway route. Nothing
   outside the cluster can reach it.
2. **File-based, read-only config** — `APPRISE_STATEFUL_MODE=simple` +
   `APPRISE_CONFIG_LOCK=yes` + `APPRISE_API_ONLY=yes`. This **disables the
   runtime `/add`/`/del` config API** (removing that attack surface); only
   `/notify/{key}` stays live. Each key is an app name and maps to a
   `/config/{key}.yml` file.
3. **Secrets via ESO, never in git** — see §3 and Finalized decisions.

**Interim trust model:** with no mesh and no NetworkPolicy yet, _any_ in-cluster
pod can POST. That is acceptable for a single-admin homelab
where the real exposure (the internet) is already cut off by internal-only.
The **workload-identity boundary** (only approved services may call Apprise) is
**deferred to the service mesh** — see [Future implementation](#future-implementation).

**Per-service keys: yes — as routing handles, not auth.** With `stateful_mode=
simple` each key is just a config file, so we pre-seed **one file per service**
declaratively (never via the runtime `/add` API). Keys are the notifying app's name
(no obfuscation: it would add no real protection). Their value is
**blast-radius + observability + revocation**
(kill or re-route one service without touching others), _not_ a security
boundary — that comes later from the mesh.

**Secret seeding (finalized).** An `ExternalSecret` with a **`target.template`**
renders the actual Apprise config file(s) — interpolating the `pover://` and
`ses://` URLs from AWS Secrets Manager values — into a K8s Secret mounted
read-only at `/config`. Secrets never touch git or the app spec; the config with
creds exists only at runtime. Same template trick as `apps/radicale.ts`, sourcing
from the existing `aws-secrets-manager` `ClusterSecretStore` instead of a
generator.

## 2. Pushover — hosted push (primary)

Apprise has a native **Pushover** plugin (`pover://`). Pushover is a hosted
service: Apprise POSTs to `api.pushover.net`, Pushover's cloud delivers to the
official iOS/Android apps. **There is no self-hosted endpoint and nothing to
expose** — the cluster only ever makes an outbound HTTPS request.

- **Apprise URL**: `pover://{user_key}@{app_token}` (optionally with device and
  priority). Tokens are stored in the Apprise config, sourced from a K8s Secret.
- **Apps**: official iOS + iPadOS + Android clients; no self-hosting, no APNs
  relay to operate.
- **Cost**: ~**$4.99 one-time per platform** after a 30-day trial; **10,000
  messages/month free** per account — negligible for infra alerts.
- Chosen over self-hosted push (ntfy/Gotify) for reliability and zero inbound
  exposure — see [Design rationale](#design-rationale-why-a-hosted-relay-not-self-hosted-push).

### Severity → priority mapping (finalized)

Pushover levels and the two facts that drive the mapping:

| Priority      | Behavior                                   | Quiet hours                               |
| ------------- | ------------------------------------------ | ----------------------------------------- |
| `-2` lowest   | no notification, badge only                | n/a                                       |
| `-1` low      | no sound/vibration                         | —                                         |
| `0` normal    | sound + vibration                          | **suppressed to `-1` during quiet hours** |
| `1` high      | always sound, red highlight, **no repeat** | **bypasses** quiet hours                  |
| `2` emergency | **repeats until acknowledged**             | bypasses                                  |

- **Quiet hours silently downgrade `0` → `-1`** — so anything you must not miss
  overnight needs **≥ 1**.
- **Emergency (`2`)** requires `retry` ≥ 30s and `expire` ≤ 10800s (3h); the user
  acknowledges **in the app**. The optional `callback` param is an inbound
  webhook we **do not use**, so emergency keeps the zero-inbound-exposure
  property.

Because cert-deploy runs **proactively** (a single handled failure has days of
runway before actual expiry), routine failures are **not** emergencies —
over-using emergency trains you to mute it.

| Severity tag                     | Pushover priority                              | Use for                                                                                  |
| -------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `info`                           | `0` normal                                     | success notices; fine to respect quiet hours                                             |
| `warn` / handled `critical`      | `1` high                                       | cert-deploy _failed_ but cert still valid — bypass quiet hours, no nag                   |
| dead-man-switch / true emergency | `2` emergency (`interval=300`, `expire=10800`) | **Healthchecks missed-ping** (job never ran — silent failure that can persist to expiry) |

Concretely, **three `pover://` URLs** in the Apprise config:
`?priority=normal` (tag `info,push`), `?priority=high` (tag
`warn,critical,push`) and
`?priority=emergency&interval=300&expire=10800` (tag `emergency`, used by the
Healthchecks alert route). Apprise calls Pushover's `retry` parameter
`interval`. Handled failure → high + email; "job isn't running at
all" → emergency.

## 3. AWS SES — email

Apprise has a **native Amazon SES** plugin (`ses://`) — no SMTP needed.

- **Auth (current): static AWS credentials, stored in AWS Secrets Manager.**
  IRSA is **not yet set up** in this cluster (`irsa.md` is a design doc, not
  implemented). For now, an IAM access key/secret scoped to `ses:SendRawEmail` (the action Apprise's
  SES plugin calls; also allow `ses:SendEmail`) lives
  in AWS Secrets Manager and is pulled via the existing `aws-secrets-manager`
  `ClusterSecretStore`. Apprise's `ses://` URL embeds the access key, secret,
  region, and from/to addresses, so the creds are interpolated into the Apprise
  config by the same `ExternalSecret` `target.template` that seeds Pushover (see
  §1 "Secret seeding"). Nothing lands in git or the app spec.
- **Caveat: SES sandbox** — a verified domain/sender + a production-access
  request are needed to email arbitrary recipients.
- **Future migration (deferred):** once IRSA is implemented per `irsa.md`,
  replace the static key with an IRSA-annotated ServiceAccount granting
  `ses:SendRawEmail` (zero static credentials). This is the only part of the stack
  that changes when IRSA lands; the Apprise `ses://` config swaps from
  embedded-key to environment/role-based creds.

## 4. Healthchecks — dead-man-switch

`healthchecks/healthchecks`, self-hosted. Jobs **ping on success**; it alerts on
a **missed** ping. Catches what in-script notification cannot:

- pod crash-before-script, image-pull failure, the CronJob never being scheduled.

Its own alerts route through a **Webhook integration** to
`http://apprise.apprise.svc:8000/notify/healthchecks` with tag `emergency`, so
no SMTP is configured. One check per cert-deploy CronJob (one per appliance).

Deployment notes (`apps/healthchecks.ts`):

- Postgres via `withPostgres(17, { backup: true })`; `Recreate` rollouts because
  the entrypoint runs `manage.py migrate`.
- `SECRET_KEY` is generated by ESO and persisted to
  `lab53/cluster0/healthchecks/healthchecks-secret-key`.
- `INTEGRATIONS_ALLOW_PRIVATE_IPS=True` is required, because webhooks to private
  IPs (the Apprise ClusterIP) are blocked by default. `ALLOWED_HOSTS=*` lets
  in-cluster pings and kubelet probes through; it is internal-only
  (`healthchecks.int.lab53.net`).
- Pings use slug URLs, `http://healthchecks.healthchecks.svc:8000/ping/<ping-key>/<slug>`
  (plus `/fail`), where the slug is the CronJob name, e.g. `proxmox-cert-deploy`.
  One project-wide ping key replaces a per-check UUID.

## Design rationale: why a hosted relay, not self-hosted push

The primary use case is **infra alerts you must see while away from home**
(cert-deploy failures, etc.). For that, a self-hosted, internet-exposed push
server is the wrong default — not because it's hard to harden, but because of
**failure correlation**:

- A self-hosted push server puts your **ISP + DNS + Traefik + certs + node
  health + the push pod** on the delivery path. That's the exact stack most
  likely to be degraded _during the incident you're being alerted about_. An
  alert whose job is to say "the homelab is broken" should not depend on the
  homelab's public ingress being healthy.
- On iOS specifically, a self-hosted push server (e.g. ntfy) is _already_
  partially dependent on the vendor: it must relay the APNs wake-up through
  `ntfy.sh`, and the phone then has to reach **your** server to fetch the body.
  That's the worst of both worlds — partial vendor dependence **plus** inbound
  homelab exposure.
- **Pushover inverts this:** the alerting workload makes one **outbound** HTTPS
  POST to `api.pushover.net`; the vendor cloud delivers to the phone. No inbound
  route into the cluster, nothing to harden/patch/rotate, and delivery does not
  depend on the cluster's own ingress being up.
- **Low lock-in:** Apprise abstracts the backend. If Pushover ever disappoints,
  switching to hosted ntfy, Telegram, or another backend is a URL + secret
  change, not an architectural rewrite.

**Decision:** Pushover is the single push backend for now. A self-hosted push
server (internal-only) was considered and **dropped** — one push service is
enough until there's a concrete need for a second.

**Caveats carried forward:**

- Never single-path a critical alert: `critical` routes to **both** Pushover and
  SES email.
- The alerting workload still runs _inside_ the cluster, so a total
  cluster-down event can't POST anything. Healthchecks covers the cron-level
  cases (missed ping); a true **external** uptime monitor is the complete answer
  and is a deferred follow-up.

## Tag taxonomy (fix up front)

Lock this before wiring services, so future Alertmanager routes map cleanly:

- **Severity**: `info`, `warn`, `critical`
- **Channel intent**: `push`, `email`
- **Domain**: e.g. `certs`, `storage`, `network`

Apprise config maps tags → endpoints (e.g. `critical` → push + email; `info` →
push only).

## How the cert-deploy jobs wire in

`apps/external-cert-deployer.ts` sets these env vars on every CronJob, read by
`scripts/deploy-external-certs.ts`:

- `APPRISE_URL` = `http://apprise.apprise.svc:8000`, imported from
  `apps/apprise.ts`.
- `APPRISE_KEY` = `external-cert-deployer`, the app's name.
- `HEALTHCHECK_URL`, `HEALTHCHECK_SLUG` (the CronJob name) and
  `HEALTHCHECK_PING_KEY`, which comes from the optional `healthchecks-ping-key`
  Secret. Pings are skipped until that secret exists.
- Behaviour: handled failure → Apprise `tag=critical` (push+email); a deploy
  that renewed a cert → `tag=info`; success → Healthchecks ping;
  never-ran/crashed → Healthchecks missed-ping alert.

## Observability seam (deferred)

Full metrics/observability (Prometheus/kube-state-metrics/Grafana) is a separate,
larger project — intentionally **not** bundled here. The gateway is the part
worth front-loading: when the metrics stack lands, **Alertmanager → Apprise
webhook** reuses the same push/email/tag routing. Keep the tag taxonomy stable so
those routes map directly. Until then, Healthchecks covers the cron
dead-man-switch coverage you'd otherwise need `kube_job_failed` for.

## Manual setup

Code is built (see the status line). These steps need a human:

1. **Pushover** — buy the iOS/Android license, install the apps, create an
   application token, and store `{ "user-key", "app-token" }` at
   `lab53/cluster0/apprise/pushover-credentials`.
2. **AWS SES** — verify the sender/domain, request production access, create an
   IAM user allowed `ses:SendRawEmail` + `ses:SendEmail`, and store
   `{ "access-key-id", "secret-access-key", "region", "from", "to" }` at
   `lab53/cluster0/apprise/ses-credentials`. (IRSA migration deferred — see §3.)
3. **Sync `apprise`**, then verify with a `POST /notify/external-cert-deployer`
   for each of `tag=info`, `critical` and `emergency` (the last repeats until
   acknowledged in the app).
4. **Sync `healthchecks`**, then create the admin user (there is no env var):
   `kubectl -n healthchecks exec deploy/healthchecks -- /opt/healthchecks/manage.py createsuperuser --email <you> --password <pw>`
5. In Healthchecks, create a project and add a **Webhook** integration: POST to
   `http://apprise.apprise.svc:8000/notify/healthchecks`, header
   `Content-Type: application/json`, body
   `{"title":"Cron job missed: $NAME","body":"Status: $STATUS","type":"failure","tag":"emergency"}`
   (confirm the available placeholders in the form).
6. Create one check per CronJob (`unifi-cert-deploy`, `truenas-cert-deploy`,
   `proxmox-cert-deploy`). Set the **slug** to the CronJob name, a cron schedule
   matching the CronJob, and a grace time; attach the webhook.
7. Copy the project's **ping key** into
   `lab53/cluster0/traefik/healthchecks-ping-key` as `{ "ping-key": "..." }`.
   Until then the `healthchecks-ping-key` ExternalSecret shows a sync error and
   the jobs skip pings.

## Finalized decisions

- **Apprise config security:** internal-only (ClusterIP, no external route) +
  file-based read-only config (`stateful_mode=simple`, `config_lock=yes`,
  `api_only=yes`, no runtime `/add` API). Apprise keys carry no auth — they are
  plain app names, treated as routing handles only. The workload-identity
  boundary (only approved services may call Apprise) is **deferred to the service
  mesh** — see [Future implementation](#future-implementation). See §1 "Security
  model".
- **Per-service keys:** yes, one config file per service, keyed by the
  notifying app's name (e.g. `external-cert-deployer`; no uuids/obfuscation —
  the service mesh is the real boundary), for blast-radius /
  observability / revocation — not as an auth boundary. Pre-seeded declaratively,
  never via the runtime API.
- **Secrets:** live in **AWS Secrets Manager**, pulled via the existing
  `aws-secrets-manager` `ClusterSecretStore`, and rendered into the Apprise
  `/config` by an `ExternalSecret` `target.template`. Nothing in git.
- **Pushover priority:** `info`→`0`, `warn`/handled-`critical`→`1` (high),
  dead-man-switch/true-emergency→`2` (emergency, `interval=300`, `expire=10800`).
  See §2 "Severity → priority mapping".

## Open decisions

- When to migrate SES from static credentials to IRSA (gated on `irsa.md` being
  implemented). _Owner: deferred, handled separately._

## Future implementation

Deferred work, intentionally **not** part of the initial build:

- **Service mesh (workload identity for Apprise).** A mesh is planned for this
  cluster. When it lands, it provides the real machine-to-machine auth boundary
  via **mTLS + per-workload identity** — only approved services (cert-deploy
  CronJobs, Alertmanager, etc.) may call the Apprise Service. This supersedes the
  NetworkPolicy approach that was considered and dropped, and replaces the
  interim "any in-cluster pod can POST" model (see §1). Until
  then, internal-only reachability is the only control.
    - _Note:_ a Kubernetes `NetworkPolicy` (default-deny + allow-known-callers)
      would be the lighter-weight alternative if the mesh slips — but it requires a
      CNI that enforces NetworkPolicy (currently unconfirmed in this cluster) and
      is made redundant by the mesh, so it is **not** being pursued.
- **External uptime monitor.** The alerting workload runs inside the cluster, so
  a total cluster-down event can't POST anything. Healthchecks covers cron-level
  misses; a true external monitor closes the remaining gap.
- **IRSA for SES.** Replace the static AWS key with an IRSA-annotated
  ServiceAccount once `irsa.md` is implemented (see §3).
- **Metrics/observability stack.** Prometheus/Grafana/Alertmanager — when it
  lands, Alertmanager reuses this gateway via webhook (see Observability seam).
