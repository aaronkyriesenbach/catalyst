# Modifiers

Modifiers are immutable transforms that add capabilities to a WorkloadApp.
Compose them with `applyModifiers(base, ...modifiers)`. Import from `"../modifiers"`.

## applyModifiers

```typescript
import { applyModifiers } from "../modifiers";

export default applyModifiers(base, mod1, mod2, mod3);
```

Order matters: later modifiers see the output of earlier ones. The return value
is a full `WorkloadApp` (the final export).

## withIscsiVolumes

Adds iSCSI-backed PVCs and mounts them into containers. **Forces `Recreate`
strategy** (iSCSI volumes can only be mounted by one pod at a time).

```typescript
withIscsiVolumes({
  main: [
    { name: "data", mountPath: "/data", storageRequest: "10Gi", backup: true },
    { name: "config", mountPath: "/config" },
  ],
})
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | PVC name (prefixed with the app name) |
| `mountPath` | Yes | Container mount path |
| `storageRequest` | No | Defaults to `"10Gi"` |
| `backup` | No | If `true`, creates VolSync backup resources |
| `backupSchedule` | No | Cron expression for backup schedule |

The key (e.g. `"main"`) must match a container name in `podSpec.containers`.
Throws if it doesn't.

## withNasMounts

Mounts NFS shares from the NAS (`192.168.53.120:/mnt/tank/data`) into containers.
Use for shared data that doesn't need PVC isolation (media libraries, bulk storage).

```typescript
withNasMounts({
  main: [
    { mountPath: "/music", subPath: "music" },
  ],
})
```

| Field | Required | Description |
|---|---|---|
| `mountPath` | Yes | Container mount path |
| `subPath` | No | Subdirectory under the NAS share root |

The key must match a container name. Throws if missing.

## withPostgres

Creates a dedicated Postgres StatefulSet with iSCSI-backed PVC, headless
Service, and env vars. The app connects to `<app-name>-postgres` on port 5432.

```typescript
withPostgres(17, {
  user: "myapp",
  password: "myapp",      // defaults to app name
  database: "myapp",      // defaults to app name
  variant: "alpine",      // default
  storageRequest: "10Gi", // default
  backup: true,
})
```

| Field | Required | Description |
|---|---|---|
| `version` (positional) | Yes | Postgres major version (e.g. `17`) |
| `user` | No | Defaults to app name |
| `password` | No | Defaults to app name |
| `database` | No | Defaults to app name |
| `variant` | No | `"alpine"` (default), `"bookworm"`, or `"trixie"` |
| `image` | No | Override the image. Defaults to `docker.int.lab53.net/library/postgres:<version>-<variant>` |
| `storageRequest` | No | PVC size. Defaults to `"10Gi"` |
| `backup` | No | If `true`, creates VolSync backup resources for the Postgres data |

The Postgres container includes startup and readiness probes using `pg_isready`.
Environment variables are: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PGDATA`.

## withOidcAuth

Creates PocketID OIDC client and group resources. With `middleware: true`, also
adds Traefik OIDC middleware with ESO-generated plugin secret and sets
`forwardAuth: true` on the HTTPRoute.

**Without middleware** (just create the OIDC client + group):
```typescript
withOidcAuth()
```

**With middleware** (full auth enforcement at the reverse proxy):
```typescript
withOidcAuth({
  middleware: {
    enabled: true,
    headers: [
      { name: "Remote-User", value: "{{ .claims.preferred_username }}" },
      { name: "Remote-Email", value: "{{ .claims.email }}" },
    ],
    bypassPaths: [
      { type: "prefix", path: "/api/public" },
    ],
  },
})
```

| Field | Required | Description |
|---|---|---|
| `middleware.enabled` | No | If `true`, creates the Traefik OIDC middleware and sets `forwardAuth: true`. Defaults to `false`. |
| `middleware.headers` | No | Headers to pass from the OIDC claims to the backend |
| `middleware.bypassPaths` | No | Paths to skip auth (e.g. public health endpoints) |

Without middleware, the app is responsible for its own auth. With middleware,
Traefik intercepts all requests, redirects unauthenticated users to PocketID,
and passes user headers to the backend.

## Precedence

Modifiers are applied left-to-right. `withPostgres` and `withOidcAuth` add to
`extraResources`, so put them after storage modifiers if order matters.