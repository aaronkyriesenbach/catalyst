# Internal Certificate Rotation & External-Appliance Deployment

How the internal CA and its leaf certificates are issued, why the leaves were
expiring early, and the design for automatically pushing renewed leaves to the
external appliances (TrueNAS, Proxmox, UniFi) that live **outside** the cluster.

## Background

`cert-manager` runs an internal CA (`ClusterIssuer/internal-ca`, backed by the
self-signed-bootstrapped `internal-root-ca` Certificate). It issues leaf certs
for the externally-proxied appliances at `*.backend.lab53.net`:

- `unifi-backend-cert`, `truenas-backend-cert`, `proxmox-backend-cert` (in the
  `traefik` namespace), defined in `apps/traefik/externalApps.ts`.

These leaves are presented by each appliance **to Traefik**, which validates
them against the `internal-root-ca-bundle` ConfigMap via a `BackendTLSPolicy`.
They are **not** browser-facing — the public, browser-facing certs are the
separate Let's Encrypt `*.lab53.net` / `*.int.lab53.net` certs.

Because the appliances are not in the cluster, a renewed leaf has to be copied
onto each appliance by hand today. That manual step is what this design
eliminates.

## The "leaves still expire in 3 months" bug

### Symptom
After pinning the CA key and setting long durations (commit `ff6a5a8`,
*"fix: pin keys for internal certs"*), the downloaded leaf certs still showed a
90-day validity window.

### Root cause
The config was correct, but **already-issued certs were not re-issued.**

| Certificate | `spec.duration` (synced to cluster) | issued cert validity |
|---|---|---|
| `internal-root-ca` | `87600h` (10 yr) | **90 days** |
| `*-backend-cert` | `8760h` (1 yr) | **90 days** |

Timeline:
- **Jun 5** — certs issued under the *old* config (no `duration`), so they got
  cert-manager's default **90 days** (2160h = "3 months").
- **Jun 9 12:13** — the fix was committed/pushed and ArgoCD synced the new
  `spec.duration` + `privateKey.rotationPolicy: Never`.
- The live cert objects now have the right **spec**, but the issued **certs**
  are the stale Jun-5 ones (`status.notAfter` still 90 days, `Ready=True`).

cert-manager only treats `duration` as a re-issuance trigger when it can compare
against a stored `CertificateRequest`; in practice these were left "up to date"
and will not pick up the new duration until their natural renewal
(`status.renewalTime`, ~Aug 4). See the cert-manager FAQ
("When do certs get re-issued") and the trigger policy chain.

### Remediation: force re-issuance (key-preserving)
Order matters — **root CA first** (so leaves are signed under the now-long-lived
CA), then the leaves:

1. Force-renew `internal-root-ca` (cert-manager ns) → 10-year cert, **reuses the
   pinned key** (`rotationPolicy: Never`), so the chain the appliances trust
   stays intact.
2. Force-renew the three `*-backend-cert` leaves (traefik ns).
3. `bun run sync-external-certs` to pull the fresh certs/keys.
4. Re-push to the appliances (manually for now; automated by the design below).

> **Do NOT delete the Secrets to force renewal.** Deleting the root CA Secret
> discards the pinned key, generating a *new* CA key and breaking trust on every
> appliance. Renewal must preserve the key (`cmctl renew`, or the equivalent
> `kubectl patch --subresource=status` setting the `Issuing` condition).
> `cmctl` is not currently installed.

## Certificate validity policy

With automated deployment in place (below), short-lived leaves become the more
secure default — the internal CA has **no OCSP/CRL revocation**, so expiry *is*
the only practical revocation mechanism, and frequent rotation keeps the deploy
pipeline exercised and healthy. The asymmetry is the whole design:

> **Long, pinned, stable CA + short, auto-rotated, freshly-keyed leaves.**

| Cert | Duration | renewBefore | Key rotation | Rationale |
|---|---|---|---|---|
| **Root CA** (`internal-root-ca`) | `87600h` (10y) | `2160h` (90d) | `Never` (pinned) | Trust anchor in appliance stores; rotating it is the expensive manual op we engineer around. |
| **Leaves** (`*-backend-cert`) | `2160h` (90d) | `720h` (30d) | `Always` (fresh key each renewal) | Bounds key-exposure to weeks; 30-day renewBefore gives a full month of hourly auto-retries before expiry. |

Guardrails:
- **Never shorten below the automation failure-recovery runway.** `renewBefore`
  is that runway. UniFi's fragile deploy path is the binding constraint — do not
  go sub-week. (Could tighten leaves to ~45d/15d later, *with* solid alerting.)
- **Shortening is only safe with alerting on deploy failures** — otherwise a
  broken pipeline becomes a silent outage. Alerting is a hard prerequisite (see
  Notifications, under discussion).
- Leaf `rotationPolicy: Always` is safe **only because** deployment is automated
  (cert+key are pushed together). The manual-era `Never` is no longer needed on
  leaves; the **CA stays `Never`**.

Implementation: update `duration` / `renewBefore` / `privateKey.rotationPolicy`
on the leaf `Certificate` in `apps/traefik/externalApps.ts`.

## Automated in-cluster deployment

### Recommended architecture: scheduled reconciliation
**One `CronJob` per appliance, in the `traefik` namespace, running the stock
`oven/bun` image with a Bun script mounted from a ConfigMap.** No custom image,
no SSH keys, no RBAC.

```
cert-manager renews leaf Secret (traefik ns)
          │
          ▼
CronJob (hourly, per appliance)  ──mounts──>  *-backend-cert Secret (tls.crt/tls.key)
          │                       ──mounts──>  deployer-credentials Secret (ESO)
          │                       ──mounts──>  deploy script (ConfigMap)
          ▼
  1. TLS-probe the appliance's LIVE served cert
  2. SHA-256 compare vs the Secret's cert
  3. drift? → push via appliance API + reload
  4. re-probe to confirm
```

### Key decisions

1. **Trigger — CronJob, not event-driven.** Leaves renew rarely, so event speed
   buys nothing. Crucially, **UniFi firmware updates silently reset the cert** —
   the Secret doesn't change but the appliance drifts, which only *actual-state*
   reconciliation catches. Run hourly; worst case after a firmware reset is ~1h
   of stale cert.

2. **Image — stock `oven/bun` + ConfigMap-mounted script.** Doing **UniFi via
   its undocumented local HTTPS API** (rather than SSH file-drop) makes all
   three deploys pure Bun `fetch`/`WebSocket` calls — zero binary deps, so no
   custom image and no build/publish pipeline (which this repo doesn't have).
   The script is small, Git-versioned, dependency-free.

3. **Secret access — direct mount in `traefik`.** The leaf Secrets already live
   there, so the job mounts `tls.crt`/`tls.key` as read-only volumes. No
   ServiceAccount token (`automountServiceAccountToken: false`), no `kubectl`,
   no reflector.

4. **Idempotency — compare against the appliance's LIVE cert.** A stored
   "last-deployed" annotation lies after a UniFi firmware reset or a backup
   restore. The live TLS cert is the real state Traefik validates, so the job
   TLS-probes each appliance, compares fingerprints, and **only pushes on
   mismatch** (otherwise hourly reconciliation = hourly service restarts).

5. **Failure isolation & safety.** Per-appliance CronJobs so one appliance being
   down never blocks the others. `concurrencyPolicy: Forbid`,
   `restartPolicy: Never`, `backoffLimit: 1`, `activeDeadlineSeconds: ~300`,
   retain failed-job history.

### Per-appliance deploy mechanisms

**Proxmox VE** (`192.168.53.100:8006`) — clean official REST API, **per node**:
- `POST /api2/json/nodes/{node}/certificates/custom` (one call per cluster node)
- Body: `certificates` (PEM chain, leaf first), `key` (PEM), `force=1`, `restart=1`.
- Auth: API Token header `Authorization: PVEAPIToken=USER@REALM!TOKENID=UUID`,
  needs `Sys.Modify` on `/nodes` (cluster-wide, one token for all nodes).
  `restart=1` reloads that node's pveproxy (no node reboot).
- The cert (single SAN `proxmox.backend.lab53.net`) is pushed identically to every
  node. The strategy carries a `nodes: { name, ipAddress }[]` list; the deploy job
  probes and deploys **each node independently** (so a newly-added or reset node
  is caught and fixed on its own).

**TrueNAS SCALE/CE** (`192.168.53.120:443`) — official WebSocket JSON-RPC
(legacy REST removed in v26). Stateful 4-step flow:
1. `auth.login_ex` `{mechanism:"API_KEY_PLAIN", username, api_key}`
2. `certificate.create` `{create_type:"CERTIFICATE_CREATE_IMPORTED", name:"<datestamped>", certificate, privatekey}` (job — poll it)
3. `system.general.update` `{ui_certificate:<new_id>}` → `system.general.ui_restart`
4. `certificate.delete(<old_id>)`
- **Names must be unique** (datestamp them); imported certs **accumulate** and
  must be pruned. Prune conservatively: only old certs matching the prefix, never
  the active `ui_certificate` id.

**UniFi OS console** (`192.168.1.1:443`) — **no official cert-upload API.**
Primary path: undocumented local API (`POST /api/auth/login` →
`POST /api/userCertificates` → `PUT /api/userCertificates/{id}/status` activate),
pure HTTPS. This is the fragile link — isolate it as its own CronJob.
Fallback if the API breaks: SSH file-drop (scp to
`/data/unifi-core/config/unifi-core.{crt,key}` + `systemctl restart unifi-core`,
as `acme.sh deploy/unifi.sh` does) on a small custom image, scoped to UniFi only.

### GitOps modeling

Extend `ExternalApp` (`types.ts`) with an optional `certDeploy` discriminated
union; add the strategy to the three entries in `externalApps.config.ts`
(referencing credential **Secret names/keys only**, never values, provisioned
via ESO). Add a top-level `apps/external-cert-deployer.ts` `StaticApp` (top-level
file — `main.ts` only discovers files directly under `apps/`) that renders one
CronJob per configured appliance plus the shared script ConfigMap. The runtime
script reads a small **target JSON** (cert Secret name, backend hostname, IP,
port, strategy) — it never imports repo modules.

```ts
type KeyedSecret<K extends string> = { name: string; keys: Record<K, string> };

type CertDeployStrategy =
  | { type: "proxmox"; node: string; credentials: KeyedSecret<"tokenId" | "tokenSecret"> }
  | { type: "truenas"; credentials: KeyedSecret<"apiKey">; importedNamePrefix?: string; pruneKeep?: number }
  | { type: "unifi-local-api"; credentials: KeyedSecret<"apiKey"> };

export type ExternalApp = {
  name: string;
  ipAddress: string;
  port: number;
  subDomain?: string;
  insecure?: boolean;
  certDeploy?: CertDeployStrategy; // ← new
};
```

### Main risk
UniFi's undocumented `/api/userCertificates` can break on a firmware update.
It's already isolated as its own CronJob, so Proxmox + TrueNAS keep working; the
fallback is a `unifi-ssh` strategy on a small custom image, scoped to UniFi only.

## Implementation status

**Done (cert work):**
1. ✅ Leaf `duration`/`renewBefore`/`rotationPolicy` set to `2160h`/`720h`/`Always`
   in `externalApps.ts`; CA stays `87600h` + `Never`.
2. ✅ `ExternalApp` extended with the `certDeploy` discriminated union (`types.ts`);
   strategies added to the three entries in `externalApps.config.ts`.
3. ✅ `scripts/deploy-external-certs.ts` — self-contained Bun deploy script
   (TLS-probe → SHA-256 compare → per-strategy deploy), with no-op `notify()`
   (Apprise) + Healthchecks ping hooks gated on env.
4. ✅ `apps/external-cert-deployer.ts` — `StaticApp` (namespace `traefik`)
   rendering the script ConfigMap + one ExternalSecret + one staggered CronJob
   per appliance. Verified via `bun run render`.

**Not force-renewing the current certs** — intentional. Leaf duration is
unchanged in effect (already 90d), the config changes don't trigger immediate
reissuance, and the root CA self-heals at its Aug-4 `renewalTime` (before Sep 3
expiry). Everything rolls into the new regime at the **natural early-August
renewal** — which is therefore the soft deadline for the deploy automation to be
working (or a one-time manual push).

**Remaining manual / validation steps (before this is live):**
- **Populate AWS Secrets Manager** with one JSON secret per appliance at
  `lab53/cluster0/traefik/<name>-deploy-creds`:
  - `proxmox-deploy-creds`: `{ "token-id": "user@realm!tokenid", "token-secret": "<uuid>" }`
  - `truenas-deploy-creds`: `{ "api-key": "<key>" }`
  - `unifi-deploy-creds`: `{ "username": "<user>", "password": "<pass>" }`
    — must be a **local-only UniFi OS admin** account (not a Ubiquiti cloud/SSO
    login). UniFi's `X-API-KEY` keys only cover the Network Integration API, not
    the console `/api/userCertificates` endpoint, so a session login
    (username/password) is required.
- **Confirm the Proxmox node list** — `externalApps.config.ts` lists
  `node1` (192.168.53.100) and `node2` (192.168.53.101). Verify node2's IP and
  **append any future nodes** to the `nodes` array; each is probed/deployed
  independently. One cluster-wide API token (`Sys.Modify` on `/nodes`) covers all.
- **Image pinning/mirror** — CronJobs use `oven/bun:1.2`; repoint to
  `docker.int.lab53.net` and pin a patch version if desired.
- **Real-device validation** — dry-run each strategy against the live appliance
  before trusting it. The UniFi local API (`/api/userCertificates`) and the
  TrueNAS WS flow especially need a live test. The probe→compare logic makes the
  jobs safe to run repeatedly (no-op when in sync).
- **Wire failure alerting** (Notifications, below) — set `APPRISE_URL`/
  `APPRISE_KEY` via the optional `cert-deploy-notify` ConfigMap and add a per-job
  `HEALTHCHECK_URL`.

### Proxmox API token & permissions

PVE users/tokens/ACLs live in the clustered `pmxcfs` (`/etc/pve`), so create
**one** token on **any** node — it works cluster-wide, including future nodes.
**No per-node account, no system/PAM account, no root.** The only privilege
needed is **`Sys.Modify` on `/nodes`** (the cert endpoint requires it; granting at
`/nodes` propagates to every node). The drift check is a TLS probe, not an API
call, so no read/audit privilege is required.

```bash
# run once on any node — propagates cluster-wide
pveum role add CertDeploy --privs "Sys.Modify"
pveum user add cert-deploy@pve
pveum user token add cert-deploy@pve automation --privsep 1   # prints secret ONCE
pveum acl modify /nodes --roles CertDeploy --tokens 'cert-deploy@pve!automation'
```

With `--privsep 1` the token carries its own (empty-by-default) permissions, so
the ACL is assigned to the **token**; the user itself stays permission-less.

AWS SM secret `lab53/cluster0/traefik/proxmox-deploy-creds`:
```json
{ "token-id": "cert-deploy@pve!automation", "token-secret": "<uuid from token add>" }
```

### Routing vs. deploy IPs (Proxmox)

`ExternalApp.ipAddress` is the **Traefik routing backend** (drives the
EndpointSlice/Service), *not* deploy config. TrueNAS/UniFi deploy to it; the
**Proxmox deploy ignores it** and uses `certDeploy.nodes[]`. Traefik currently
routes Proxmox to a single node (no failover); making the EndpointSlice span all
nodes would add HA and let the node list be the single source of truth.



## Notifications

Alerting on deploy-CronJob failure is a hard prerequisite for shortening leaf
validity. The goal is broader than these scripts: a **flexible, cluster-wide
notification system** supporting **push + email**, reusable by any service.

### Current state (greenfield)
- **No** monitoring/alerting stack exists (no Prometheus/Alertmanager/Grafana).
- **No** existing notification tooling (no ntfy/apprise/gotify/etc.).
- **Stalwart** mail server is bootstrapped (`apps/stalwart/`) but the repo shows
  **no exposed SMTP submission Service/port** — usability as a relay must be
  verified before relying on it for email.
- ESO secret pattern (`buildGeneratedSecret` in `utils.ts`) and the idiomatic
  `WorkloadApp` shape (e.g. `apps/miniflux.ts`) are the templates to copy.

### Recommended stack: Apprise gateway + ntfy push + AWS SES email

```
any service ──POST /notify/{key} {title,body,tag}──┐
cert-deploy CronJob ─(on failure)─────────────────┤
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

**1. Apprise API — the universal gateway (the reusable layer).**
`caronc/apprise` Deployment+Service, internal-only. Services POST *once* to a
stored config key (`/notify/{key}` with `{title, body, type, tag}`) and Apprise
fans out to every configured channel. **Tag routing** (`push`, `email`,
`critical`) lets one POST hit a subset of channels. This is the piece that makes
notifications reusable: new services just POST with a tag — they never need to
know about ntfy/SES URLs, and adding Discord/Telegram later touches *only* the
Apprise config, not any service. Auth is minimal — keep it cluster-internal
(no external route) and/or front with basic auth.

**2. ntfy — self-hosted push backend.**
`binwiederhier/ntfy` Deployment+Service+PVC, exposed at e.g.
`ntfy.int.lab53.net`. Official **iOS + Android** apps (point them at the
self-hosted base-url). Protect with `auth-file` + `auth-default-access: deny-all`
and per-topic ACLs/tokens so each publisher has a scoped token. Apprise targets
it via the `ntfy://ntfy.int.lab53.net/<topic>` schema. (Chosen over Gotify:
ntfy has real iOS support, topic-based publishing, richer features, and ACLs.)

**3. Email — AWS SES via Apprise's native `ses://`.**
Apprise has a native Amazon SES plugin, so no SMTP needed. Best fit given the
existing AWS/IRSA setup: give the Apprise pod an **IRSA role with `ses:SendEmail`**
→ zero static credentials. (Fallback: SES SMTP endpoint via `mailto://` with SES
SMTP creds pulled from AWS Secrets Manager via ESO.) Note **SES sandbox** — a
verified domain/sender and likely a production-access request are needed to email
arbitrary recipients.

**4. Healthchecks — dead-man-switch for "the job never ran".**
`healthchecks/healthchecks` self-hosted. The cert-deploy CronJobs **ping on
success**; Healthchecks alerts when a ping is *missed*. This catches the failure
modes in-script notification cannot — pod crash-before-script, image-pull
failure, the CronJob never being scheduled. Its own alerts route to email and/or
the Apprise webhook.

### How the cert-deploy jobs use it
- **Handled failure** (probe/deploy threw) → the script POSTs to Apprise with
  `tag=critical` → push + email immediately. Include appliance, error, cert
  fingerprints.
- **Success** → `curl` ping to the job's Healthchecks check.
- **Never ran / crashed** → Healthchecks notices the missing ping and alerts.

This two-layer approach (in-script notify + dead-man-switch) is the right weight
for a 3-appliance homelab. **Prometheus/Alertmanager is intentionally skipped** —
there's no existing stack and the full kube-prometheus-stack is far too heavy for
this; revisit only if cluster-wide observability is wanted later.
`kubernetes-event-exporter` is an optional middle-ground if pod-level event
alerting is later desired.

### Build order
1. `apps/ntfy.ts` — self-hosted ntfy (`WorkloadApp`, PVC, ACL auth-file via ESO,
   `externallyAccessible`/internal route). Install phone apps, verify push.
2. `apps/apprise.ts` — Apprise API (`WorkloadApp`, internal-only), with a stored
   config defining `push`/`email`/`critical` tag routing to ntfy + `ses://`.
3. Set up AWS SES: verify a sender/domain, request production access, and grant
   the Apprise pod an IRSA role with `ses:SendEmail` (no static creds).
4. `apps/healthchecks.ts` — self-hosted Healthchecks; create a check per
   cert-deploy CronJob.
5. Wire the cert-deploy script: set `APPRISE_URL`/`APPRISE_KEY` via the optional
   `cert-deploy-notify` ConfigMap and a per-job `HEALTHCHECK_URL`.

## Observability (deferred, designed-for)

Full cluster observability (metrics, dashboards, alerting) is intended later but
**deliberately out of this scope** — the metrics stack (Prometheus /
kube-state-metrics / node-exporter / Grafana + storage + retention + rules) is a
large independent project, and bundling it would balloon and delay the cert work.

The part worth front-loading *is* being built now: the **Apprise gateway is the
shared notification control plane** observability will plug into. When the metrics
stack lands, **Alertmanager routes to Apprise via webhook** → same push/email and
tag routing, zero rework. To keep that seam clean, the Apprise tag taxonomy
(`severity:info|warn|critical` + a domain tag) should be fixed up front so future
Alertmanager routes map onto it directly. Until then, Healthchecks covers the
cron dead-man-switch coverage you'd otherwise need `kube_job_failed` for.


