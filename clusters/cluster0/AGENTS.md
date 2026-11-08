# CLUSTER0 KNOWLEDGE BASE

This cluster's own services and wiring. Framework conventions (apps, modifiers, probes, secrets, Helm charts, images, Renovate) live in the repo-root `AGENTS.md`.
Paths in this file are relative to `clusters/cluster0/`.

### Notifications

Services send push and email by POSTing `{title, body, type, tag}` to `<appriseUrl>/notify/<app-name>` (`apps/apprise.ts`). Apprise has no authentication, so it has no HTTPRoute and is reachable only inside the cluster; the key is just the notifying app's name and must be listed in `appriseNotifiers`, which renders `/config/<app-name>.yml` from `buildAppriseConfig()` in `packages/platform/notifications.ts`. The `tag` is a severity and `severityDelivery` in `notifications.ts` is the one table that says what each delivers: `info` and `warning` → SES email only, `critical` → SES email only, `emergency` → Pushover emergency (repeats until acknowledged) + email; add `push` or `email` (space-separated) to narrow to one channel, and a tag no URL carries returns 424. Alertmanager (`apps/victoria-metrics/alertmanager.ts`) sends `warning`, `critical` and `emergency` alerts with the matching tag and drops the rest; `alertSeverityOverrides` re-routes a single alert by name. Credentials come from AWS Secrets Manager through an ExternalSecret template (`lab53/cluster0/apprise/pushover-credentials` and `ses-credentials`, key names in `apps/apprise.ts`). Gatus (`apps/gatus.ts`) is the dead-man switch for the cert-deploy CronJobs: see Status page. It posts to `/notify/gatus`.

### Status page (Gatus)

`apps/gatus.ts` serves a public status page at `status.lab53.net` (`externallyAccessible`, default WAF, no login) with history in Postgres. Its config is generated in TypeScript into the `gatus-config` ConfigMap; do not hand-write Gatus YAML.

- **What it checks** comes from each app's `status` field (`StatusDeclaration`, `packages/platform/status.ts`). A `WorkloadApp` with a `webPort` derives it from its readiness probe (Service check) plus its hostname (`Routes` group, and `Public` for externally accessible apps: resolved through 1.1.1.1 so it travels Cloudflare and the Tunnel). Every other app must declare `status: { targets }` (built with `httpTarget`, `tcpTarget`, `dnsTarget`, `routeTargets`, `serviceUrl`) or `status: { exempt: "<reason>" }`; `bun run render gatus` throws for an app with neither. An app with `autoSync: false` is skipped, because it may not be deployed and its checks would only report it down. A route check counts any status below 500 except 404 as up, because forward auth answers 302/401.
- **Aggregation:** `apps/gatus.ts` builds its config in a `derive` hook that reads every app's declaration (see the repo-root file), skips itself, and gets the authentik checks from authentik's own `status.targets`. Code that other apps import from Gatus belongs in `apps/gatus/common.ts`, which loads nothing.
- **The page is public:** every endpoint sets `ui.hide-*`, so URLs, hostnames, ports, errors and conditions never render. Keep `metrics` off, because `/metrics` shares the public port.
- **Alerts** go to Apprise through Gatus's `custom` provider (`apps/gatus/alerting.ts`). `groupSeverity` there maps a group to a severity: `Certificates` → `critical`, every other group → `warning`. Both are email only, so nothing from Gatus pages. Groups are the `StatusGroup` enum in `status.ts`; renaming one changes its routing.
- **Cert-deploy heartbeats:** each cert-deploy CronJob pushes its result to `POST <gatusUrl>/api/v1/endpoints/certificates_<cronjob-name>/external` with a bearer token (`heartbeatKey` in `apps/gatus/common.ts`; Gatus lowercases keys and matches them exactly, and rejects two checks in a group whose names differ only by case). Gatus fails the check when nothing arrives for 3h, so a job that never ran alerts. The token is generated and seeded into AWS by `apps/gatus.ts` (`lab53/cluster0/gatus/gatus-heartbeat`) and copied into the `traefik` namespace by the deployer's ExternalSecret.

### Routing

- Internal: `<name>.int.lab53.net` → gateway `traefik-internal`
- External: `<name>.lab53.net` → gateways `traefik-external` + `traefik-internal`
- Controlled by `externallyAccessible` flag. Override hostname with `subDomain`.
- `withForwardAuth()` adds the `forward-auth` filter plus a first rule routing `/outpost.goauthentik.io/` on the app's host to `authentik-server` (a `ReferenceGrant` from `apps/authentik.ts` allows it).
- Every externally accessible route is behind the WAF unless exempted with a reason (see Web application firewall). `buildRoute` throws for an external route without `waf`.

### Identity (authentik)

authentik (`apps/authentik.ts`, `authentik` namespace, Helm chart + Postgres) provides login for the cluster's apps; see `docs/authentik.md`. Configuration is declarative through blueprints generated in TypeScript: an app declares `oidc` (via `withForwardAuth()` or `withOidcClient()`) and `apps/authentik.ts` reads every app's declaration in its `derive` hook to create its group, provider, application, policy binding and `ReferenceGrant`. Access is per app through a group named after the app. `apps/authentik/users.config.ts` lists users enforced from Git; everyone else is invited in the authentik UI. The hostname is `authentikHostOptions` in `packages/platform/auth.ts` (`auth.lab53.net`, externally accessible because public apps use it). Forward auth uses the embedded outpost through one identical `forward-auth` Middleware per namespace, so no plugin or per-app secret is needed. Client secrets for `withOidcClient` live in AWS (`lab53/cluster0/authentik/oidc-<app>`), rotate every 90 days, and reach authentik as a rendered blueprint file because authentik skips blueprints whose file hash is unchanged. The SMTP credentials (`lab53/cluster0/authentik/smtp-credentials`) are created by hand.

### Media stack (arr)

`apps/arr.ts` is one Argo app (namespace `arr`) for Radarr, Sonarr, Lidarr, Prowlarr, SABnzbd, FlareSolverr and a gluetun + qBittorrent pod, with every setting in Git: env vars, init scripts and a Configarr CronJob (`apps/arr/configarr.config.ts`). Every container starts non-root except gluetun, which needs root and `NET_ADMIN`; no Pod Security level is enforced on the namespace yet. The apps share one NFS export (`/mnt/tank/data/media`) mounted at `/data` so downloads hardlink into libraries. Each UI is its own forward-auth application, registered through `additionalOidc`.

### Jellyfin configuration

Jellyfin cannot be given an API key from outside, so two keys are created by hand (Dashboard, API Keys) and stored in AWS: `lab53/cluster0/jellyfin/jellarr-credentials` (Jellarr) and `lab53/cluster0/arr/jellyfin-credentials` (Configarr), both with property `api-key`. `apps/jellyfin/jellarr.ts` is a Jellarr CronJob applying `apps/jellyfin/jellarr.config.ts` (system, encoding, libraries, branding, plugin repositories). Users and the SSO-Auth settings stay in the Jellyfin UI. The CronJob runs `ghcr.io/aaronkyriesenbach/jellarr`, built from the `aaronkyriesenbach/jellarr` fork, because upstream Jellarr v0.1.0 authenticates with `X-Emby-Token`, which Jellyfin 12 rejects with 401 (upstream PR venkyr77/jellarr#79, merged in the fork); switch back to upstream once a release contains that fix. Configarr's `Jellyfin` connection on Radarr and Sonarr refreshes the library on import, upgrade, rename and delete, mapping `/data/movies` and `/data/tv` to Jellyfin's `/movies` and `/tv`.

### Web application firewall

`externallyAccessible: true` apps are inspected by CrowdSec AppSec through the community Traefik bouncer plugin; see `docs/waf.md`. `renderWorkload` adds a `crowdsec-appsec` Middleware and a WAF `ExtensionRef` filter (before `forward-auth`) automatically. Change it per app with `withWaf({ profile?, bodyLimit? })` (profiles `default` and `strict`, defined in `packages/platform/waf.ts`) or opt out with `withoutWaf("<reason>")`; the reason is mandatory. `StaticApp`s that call `buildRoute` directly must pass `waf` (Immich is exempt for large uploads). Profiles each need their own AppSec port, so `apps/crowdsec.ts` generates listeners and Services from the table in `packages/platform/waf.ts`. The plugin fails open on AppSec/LAPI errors and trusts pod/service/LAN CIDRs. The bouncer key lives in AWS (`lab53/cluster0/crowdsec/crowdsec-keys`) and is copied into the `traefik` namespace for Traefik to mount (its pods wait in `ContainerCreating` until `crowdsec` has created that secret). The plugin version is pinned in `apps/traefik/values.yaml`, which Renovate does not track.

### Public access (Cloudflare Tunnel)

No inbound ports are open. `apps/cloudflared.ts` runs a locally-managed tunnel (`edge.cloudflareTunnelId` in `cluster.ts`) whose `config.yml` forwards `*.lab53.net` to Traefik over HTTPS and answers 404 for `*.int.lab53.net`. Public DNS exists only for hostnames external-dns publishes, so internal names are never routable through it.

- **DNS**: `lab53.net` is hosted at Cloudflare (registration stays at Route 53). `external-dns-ext` uses the Cloudflare provider with `--cloudflare-proxied`; the `external-dns.kubernetes.io/target` annotation on the `traefik-external` Gateway points every record at `<tunnel-id>.cfargotunnel.com`. Annotations must use the `external-dns.kubernetes.io/` prefix: external-dns ignores the old `alpha` prefix since v0.22, which silently turns records into A records for the Gateway's private IP.
- **Certificates**: the cert-manager issuers solve DNS-01 through Cloudflare.
- **Secrets** (AWS Secrets Manager): `lab53/cluster0/cloudflared/tunnel-credentials` (raw `cloudflared tunnel create` JSON), `lab53/cluster0/external-dns/cloudflare-api-token` and `lab53/cluster0/cert-manager/cloudflare-api-token` (JSON property `api-token`, zone-scoped DNS edit tokens).
- **Limits**: Cloudflare caps proxied request bodies at 100 MB on the Free plan, so large uploads (e.g. Immich videos) must go through the internal hostname on the LAN. Streaming large media through the proxy is restricted by Cloudflare's terms.
- **Traefik** is the official `traefik/traefik` chart in the `traefik` namespace, declared in `apps/traefik.ts` with values in `apps/traefik/values.yaml`; k3s's bundled Traefik is turned off with `disable: traefik` in `/etc/rancher/k3s/config.yaml`. The values raise the `https` read/idle timeouts for long uploads and trust pod IPs for forwarded headers. It runs 2 replicas with soft pod anti-affinity and a PodDisruptionBudget (`minAvailable: 1`), and the Service takes the kube-vip VIP `192.168.53.201`. The chart ships the Traefik CRDs, so deleting the Application would delete every Middleware: use `argocd app delete --cascade=false`. The Gateway API CRDs come from `apps/gateway-api.ts` (upstream standard-install bundle, pinned in that file, Renovate does not track it), applied server-side with `Prune=false,Delete=false`; only upgrade within the standard channel and never downgrade. Its image is not mirrored through `zot.int.lab53.net`, because that registry is served through Traefik and a restarted pod could not pull its own image.

### External Apps (traefik module)

- Defined in `apps/traefik/externalApps.config.ts` — proxied non-cluster services (UniFi, TrueNAS, Proxmox).
- Auto-generates EndpointSlice, Service, Certificate, BackendTLSPolicy, and HTTPRoute per entry.

### Infrastructure

- NAS: IP `192.168.53.120`, base path `/mnt/tank/data`, in `site.nas` (`site.ts`), used by `withNasMounts` and the NAS volume builders.
- Private registry mirror: `zot.int.lab53.net` (pull-through cache for Docker Hub, ghcr.io, quay.io, registry.k8s.io and docker.dragonflydb.io).
- `bootstrap/` holds only what bootstraps ArgoCD (its Helm values and the root Application), applied by hand. Everything else, including kube-vip and Traefik, is an ArgoCD app under `apps/`; nothing is copied to the k3s server manifest directory.
- **kube-vip** (`apps/kube-vip.ts`, `kube-system`) holds the API server VIP and the Traefik VIP, both `network.vips` in `cluster.ts` (`192.168.53.200` and `192.168.53.201`). Its resources carry `Prune=false,Delete=false` so removing the app or a file never deletes the VIP provider, and a rollout fails both VIPs over one node at a time, so merge changes to it deliberately. Renovate bumps are PR-only. Its image is on ghcr.io, not the mirror, because the mirror is served through the VIP.
