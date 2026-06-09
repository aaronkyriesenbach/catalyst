# Notification Stack

A flexible, cluster-wide notification system: **push + email, reusable by any
service** (not just the cert-deploy jobs). Status: **designed, not yet built.**
The cert-deploy jobs already have dormant hooks for it (see
`external-cert-rotation.md`).

## Goals

- **Push** notifications to phone (iOS + Android).
- **Email** notifications.
- **Reusable** — any cluster service emits notifications the same way; adding a
  new channel (Discord/Telegram/SMS) must not touch every service.
- **Designed for future observability** — when a metrics stack lands later,
  Alertmanager plugs into the same gateway with no rework.

## Architecture

```
any service ──POST /notify/{key} {title,body,tag}──┐
cert-deploy CronJob ─(on failure)─────────────────┤
(future) Alertmanager ─(webhook)──────────────────┤
                                                   ▼
                                            Apprise API (gateway)
                                       tag routing: push / email / critical
                                          │                     │
                                   ntfy:// │                     │ ses://
                                          ▼                     ▼
                                    ntfy (self-host) ──push──> phone (iOS/Android)
                                                          AWS SES ──> inbox

cert-deploy CronJob ──(on success) ping──> Healthchecks ──(missed ping)──> Apprise
```

Four components: **Apprise** (gateway), **ntfy** (push backend), **AWS SES**
(email), **Healthchecks** (dead-man-switch). Rationale for each below.

## 1. Apprise API — the universal gateway

The reusable layer. `caronc/apprise` (the API server is in the same image),
deployed as a `WorkloadApp`, **internal-only** (no external route).

- Services POST **once** to a stored config key and Apprise fans out to every
  configured channel. They never need to know ntfy/SES URLs.
- **Tag routing** lets one POST target a subset of channels — `push`, `email`,
  `critical`, etc. This is what makes it reusable: a new service just POSTs with
  a tag; adding Discord later touches **only** the Apprise config.

### API
- **Stateless**: `POST /notify` with `urls` in the body.
- **Stateful** (preferred): store config under a key, then
  `POST /notify/{key}` with `{title, body, type, tag}`.
- Config management: `POST /add/{key}`, `GET /get/{key}`, `POST /del/{key}`.
- Health: `GET /status`; metrics at `/metrics`.

```bash
# Store reusable config with tags
curl -X POST http://apprise/add/cluster-alerts \
  -H 'Content-Type: application/json' \
  -d '{"format":"yaml","config":"version: 1\nurls:\n  - ntfy://ntfy.int.lab53.net/alerts:\n      tag: push,critical\n  - ses://...:\n      tag: email,critical\n"}'

# Use it; target only push endpoints
curl -X POST http://apprise/notify/cluster-alerts \
  -H 'Content-Type: application/json' \
  -d '{"title":"Disk full","body":"/var 98%","type":"warning","tag":"push"}'
```

### K8s deploy
- Image `caronc/apprise`; mount `/config` (PVC) for the stored stateful config.
- `WorkloadApp` shape (see `apps/miniflux.ts`), internal route only.
- **Auth is minimal** — keep it cluster-internal (no Gateway route) and/or front
  with basic auth. Source: caronc/apprise-api README.

## 2. ntfy — self-hosted push backend

`binwiederhier/ntfy`, `WorkloadApp` + PVC, exposed at e.g. `ntfy.int.lab53.net`.

- **Publish**: `POST /{topic}` with headers `Title`, `Priority` (min..urgent),
  `Tags`, `Click`, `Markdown`.
- **Official iOS + Android apps** — point them at the self-hosted base-url.
- **Auth/ACL**: `auth-file` + `auth-default-access: deny-all` + per-topic ACLs
  and access tokens, so each publisher gets a scoped token.
- **Apprise → ntfy**: `ntfy://ntfy.int.lab53.net/<topic>` (self-hosted host
  supported).
- Chosen over Gotify: real iOS support, topic-based publish, richer features,
  ACLs.

Minimal `server.yml`:
```yaml
base-url: "https://ntfy.int.lab53.net"
listen-http: ":2586"
behind-proxy: true
cache-file: "/var/cache/ntfy/cache.db"
auth-file: "/var/lib/ntfy/user.db"
auth-default-access: "deny-all"
```

## 3. AWS SES — email

Apprise has a **native Amazon SES** plugin (`ses://`) — no SMTP needed.

- Best fit given existing AWS/IRSA: give the Apprise pod an **IRSA role with
  `ses:SendEmail`** → zero static credentials.
- Fallback: SES SMTP endpoint via `mailto://` with SES SMTP creds in AWS SM (ESO).
- **Caveat: SES sandbox** — a verified domain/sender + a production-access
  request are needed to email arbitrary recipients.

## 4. Healthchecks — dead-man-switch

`healthchecks/healthchecks`, self-hosted. Jobs **ping on success**; it alerts on
a **missed** ping. Catches what in-script notification cannot:

- pod crash-before-script, image-pull failure, the CronJob never being scheduled.

Its own alerts route to email and/or the Apprise webhook. One check per
cert-deploy CronJob.

## Tag taxonomy (fix up front)

Lock this before wiring services, so future Alertmanager routes map cleanly:

- **Severity**: `info`, `warn`, `critical`
- **Channel intent**: `push`, `email`
- **Domain**: e.g. `certs`, `storage`, `network`

Apprise config maps tags → endpoints (e.g. `critical` → push + email; `info` →
push only).

## How the cert-deploy jobs wire in

Hooks already exist in `scripts/deploy-external-certs.ts` and
`apps/external-cert-deployer.ts` (dormant until env is set):

- Create a `cert-deploy-notify` ConfigMap in `traefik` (the CronJobs already
  reference it via `envFrom … optional: true`) with:
  - `APPRISE_URL` = `http://apprise.<ns>.svc:8000`
  - `APPRISE_KEY` = the stored Apprise config key
- Add a per-job `HEALTHCHECK_URL` env (each appliance = its own check).
- Behaviour: handled failure → Apprise `tag=critical` (push+email); success →
  Healthchecks ping; never-ran/crashed → Healthchecks missed-ping alert.

## Observability seam (deferred)

Full metrics/observability (Prometheus/kube-state-metrics/Grafana) is a separate,
larger project — intentionally **not** bundled here. The gateway is the part
worth front-loading: when the metrics stack lands, **Alertmanager → Apprise
webhook** reuses the same push/email/tag routing. Keep the tag taxonomy stable so
those routes map directly. Until then, Healthchecks covers the cron
dead-man-switch coverage you'd otherwise need `kube_job_failed` for.

## Build order

1. `apps/ntfy.ts` — self-hosted ntfy (PVC, ACL auth-file via ESO, internal
   route). Install phone apps, verify push.
2. `apps/apprise.ts` — Apprise API (internal-only, `/config` PVC), with a stored
   config defining `push`/`email`/`critical` tag routing to ntfy + `ses://`.
3. AWS SES — verify sender/domain, request production access, grant the Apprise
   pod an IRSA role with `ses:SendEmail`.
4. `apps/healthchecks.ts` — self-hosted Healthchecks; one check per cert-deploy
   CronJob.
5. Wire cert-deploy: create the `cert-deploy-notify` ConfigMap + per-job
   `HEALTHCHECK_URL`.

## Open decisions

- ntfy topic naming + ACL token scheme (per-service tokens vs one shared).
- Apprise stateful config: single shared key vs per-service keys.
- Whether to also expose ntfy externally (for push when off-LAN) or keep internal
  + VPN only.
