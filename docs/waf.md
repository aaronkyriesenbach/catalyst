# WAF (CrowdSec AppSec)

Externally accessible apps are inspected by the [CrowdSec AppSec component](https://docs.crowdsec.net/docs/next/appsec/intro/) through the community [crowdsec-bouncer-traefik-plugin](https://github.com/maxlerebourg/crowdsec-bouncer-traefik-plugin). Traefik forwards each request to AppSec and blocks it on a match. The plugin also enforces CrowdSec IP decisions (community blocklist, behavioural bans) in `stream` mode.

## How it works

- `apps/crowdsec.ts` installs the CrowdSec chart: LAPI, plus the AppSec pod with one listener per profile. The agent (log parsing) is disabled.
- `waf.ts` holds the profile table, constants and the `Middleware` builder. `apps/crowdsec.ts` generates the AppSec acquisitions, collections and per-profile Services from it.
- `renderWorkload` adds a `crowdsec-appsec` `Middleware` to the app's namespace and a matching `ExtensionRef` filter to its `HTTPRoute` for every app with `externallyAccessible: true`. The WAF filter comes before `oidc-auth`.
- The bouncer key is generated once into AWS (`lab53/cluster0/crowdsec/crowdsec-keys`) and pulled into two namespaces: `crowdsec` (for LAPI) and `kube-system` (`crowdsec-bouncer-key`, mounted into Traefik at `/etc/traefik/crowdsec`).

## Defaults and failure behaviour

Everything fails open: if AppSec or LAPI is unreachable, errors, or the body cannot be buffered, requests pass. Clients in the pod, service and LAN CIDRs are trusted and skip all checks, so a misread forwarded header cannot ban cloudflared's pod IP.

## Profiles

| Profile   | Port | Blocks                                            | Alerts only (out-of-band) |
| --------- | ---- | ------------------------------------------------- | ------------------------- |
| `default` | 7422 | virtual patching (CVEs) and generic rules         | OWASP CRS                 |
| `strict`  | 7423 | virtual patching, generic rules and the OWASP CRS | none                      |

`default` has few false positives. `strict` can block legitimate traffic and needs tuning (see Tuning).

Each AppSec acquisition runs its own HTTP server, so a profile costs a port and another copy of its rules in memory. Add a profile by extending `wafProfiles` in `waf.ts`.

## Changing an app

```typescript
// Pick a ruleset
export default applyModifiers(base, withWaf({ profile: "strict" }));

// Send only the first 1 MiB of each body to AppSec
export default applyModifiers(base, withWaf({ bodyLimit: 1_048_576 }));

// Opt out (a reason is mandatory)
export default applyModifiers(base, withoutWaf("Streams large uploads"));
```

`StaticApp`s that build their own route with `buildRoute` must pass `waf`: either an exemption (`{ exempt: "<reason>" }`) or options, in which case they must also add `buildWafMiddleware(...)` to their resources. `buildRoute` throws for an externally accessible route without `waf`. Routes created by charts or operators are not covered.

## Tuning false positives

1. Find the rule: `kubectl -n crowdsec exec deploy/crowdsec-appsec -- cscli alerts list` (out-of-band) or the AppSec logs (in-band).
2. Move the app back to `default`, or add a profile with a CRS exclusion plugin ([docs](https://docs.crowdsec.net/docs/next/appsec/crs/plugin_support/)).

## Operating

```bash
kubectl -n crowdsec exec deploy/crowdsec-lapi -- cscli metrics show appsec
kubectl -n crowdsec exec deploy/crowdsec-lapi -- cscli decisions list
kubectl -n crowdsec exec deploy/crowdsec-lapi -- cscli bouncers list
kubectl -n crowdsec exec deploy/crowdsec-lapi -- cscli decisions delete --ip <ip>   # unban
```

## Prerequisites and ordering

- The `external-secrets` app must be installed.
- Sync the `crowdsec` app and confirm the `crowdsec-bouncer-key` secret exists in `kube-system` before applying `cluster/traefik-config.yaml`. Traefik mounts it, so its pods stay in `ContainerCreating` without it.
- The plugin version is pinned in `cluster/traefik-config.yaml`. Renovate ignores that directory, so bump it by hand.
