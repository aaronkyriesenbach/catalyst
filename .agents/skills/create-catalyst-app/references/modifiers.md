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
    {
      name: "data",
      mountPath: "/data",
      storageRequest: "10Gi",
      backup: true,
    },
    { name: "config", mountPath: "/config" },
  ],
});
```

| Field            | Required | Description                                 |
| ---------------- | -------- | ------------------------------------------- |
| `name`           | Yes      | PVC name (prefixed with the app name)       |
| `mountPath`      | Yes      | Container mount path                        |
| `storageRequest` | No       | Defaults to `"10Gi"`                        |
| `backup`         | No       | If `true`, creates VolSync backup resources |
| `backupSchedule` | No       | Cron expression for backup schedule         |

The key (e.g. `"main"`) must match a container name in `podSpec.containers`.
Throws if it doesn't.

## withNasMounts

Mounts NFS shares from the NAS (`192.168.53.120:/mnt/tank/data`) into containers.
Use for shared data that doesn't need PVC isolation (media libraries, bulk storage).

```typescript
withNasMounts({
  main: [{ mountPath: "/music", subPath: "music" }],
});
```

| Field       | Required | Description                           |
| ----------- | -------- | ------------------------------------- |
| `mountPath` | Yes      | Container mount path                  |
| `subPath`   | No       | Subdirectory under the NAS share root |

The key must match a container name. Throws if missing.

## withPostgres

Creates a dedicated Postgres StatefulSet with iSCSI-backed PVC, headless
Service, and env vars. The app connects to `<app-name>-postgres` on port 5432.

```typescript
withPostgres(17, {
  user: "myapp",
  password: "myapp", // defaults to app name
  database: "myapp", // defaults to app name
  variant: "alpine", // default
  storageRequest: "10Gi", // default
  backup: true,
});
```

| Field                  | Required | Description                                                                            |
| ---------------------- | -------- | -------------------------------------------------------------------------------------- |
| `version` (positional) | Yes      | Postgres major in `postgresImages` in `versions.ts` (`16`, `17`, `18`)                 |
| `user`                 | No       | Defaults to app name                                                                   |
| `password`             | No       | Defaults to app name                                                                   |
| `database`             | No       | Defaults to app name                                                                   |
| `image`                | No       | Override the image. Defaults to `postgresImage(version)` (mirrored `<version>-alpine`) |
| `storageRequest`       | No       | PVC size. Defaults to `"10Gi"`                                                         |
| `backup`               | No       | If `true`, creates VolSync backup resources for the Postgres data                      |

The Postgres container includes startup and readiness probes using `pg_isready`.
Environment variables are: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PGDATA`.

## withForwardAuth

Puts the app behind a login with authentik's embedded outpost. The app needs a
`webPort`; it gets a `forward-auth` Middleware and an outpost rule on its route,
and `apps/authentik.ts` creates its group, provider and application.

```typescript
withForwardAuth();
withForwardAuth({ skipPathRegex: ["^/api/webhook$"] });
```

| Field           | Required | Description                                                |
| --------------- | -------- | ---------------------------------------------------------- |
| `skipPathRegex` | No       | Regexes for paths the outpost lets through without a login |

Add the app's name to `apps` for each user in `apps/authentik/users.config.ts`
who should have access (`"all"` covers every app). See `docs/forward-auth.md`.

## withOidcClient

For an app that runs its own OIDC flow. It registers a confidential authentik
client and creates the `<app>-oidc-credentials` Secret (`client_id`,
`client_secret`, `issuer_url`) for the app to read.

```typescript
withOidcClient({ redirectPaths: ["/api/auth/callback"] });
withOidcClient({
  redirectPaths: ["/sso/OID/redirect/authentik"],
  rotate: false,
});
```

| Field           | Required | Description                                                                               |
| --------------- | -------- | ----------------------------------------------------------------------------------------- |
| `redirectPaths` | Yes      | Callback paths on the app's own host; authentik matches them exactly                      |
| `rotate`        | No       | Rotation interval, default 90 days. `false` when the app keeps its own copy of the secret |

A `StaticApp` calls `defineOidcClient(name, options)` instead and puts the
returned `oidc` and `credentialsSecret` on the app. See `docs/authentik.md`.

## Precedence

Modifiers are applied left-to-right. `withPostgres` and `withOidcClient` add to
`extraResources`, so put them after storage modifiers if order matters.
