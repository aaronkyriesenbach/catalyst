# Forward Auth (OIDC)

OIDC-based authentication for apps using [traefik-oidc-auth](https://github.com/sevensolutions/traefik-oidc-auth) and [Pocket ID](https://auth.lab53.net/), managed by the [pocket-id-operator](https://github.com/aclerici38/pocket-id-operator).

## How it works

The `withOidcAuth()` modifier creates Pocket ID resources for each app:

1. A `PocketIDUserGroup` named after the app (controls who can access it)
2. A `PocketIDOIDCClient` with the app's callback URL and a generated credentials secret
3. Optionally, a Traefik `Middleware` + ESO-generated plugin secret for forward auth

When middleware is enabled (`withOidcAuth({ middleware: true })`):
- `forwardAuth: true` is set on the app, causing `buildRoute()` to add an `ExtensionRef` filter to the HTTPRoute
- Traefik intercepts requests, redirects unauthenticated users to Pocket ID, and passes authenticated requests through
- Session cookies are scoped to `.lab53.net`, so a single login covers all protected apps (SSO)

## Adding OIDC auth to an app

### With forward auth middleware (Traefik intercepts unauthenticated requests)

```typescript
export default applyModifiers(base, withOidcAuth({ middleware: true }));
```

This creates:
- `PocketIDUserGroup` for the app
- `PocketIDOIDCClient` with callback URL and credentials secret
- ESO `Password` generator + `ExternalSecret` for the middleware plugin secret
- Traefik `Middleware` referencing both secrets

### Without middleware (app handles OIDC itself)

```typescript
export default applyModifiers(base, withOidcAuth());
```

This creates only the `PocketIDUserGroup` and `PocketIDOIDCClient`. The app is responsible for its own OIDC flow using the credentials from the `<app-name>-oidc-credentials` secret.

### Composing with other modifiers

```typescript
export default applyModifiers(
  base,
  withPostgres(18),
  withOidcAuth({ middleware: true }),
);
```

### Verify the rendered output

```bash
bun run render <app-name>
```

Confirm the output includes:

- A `PocketIDUserGroup` named after the app
- A `PocketIDOIDCClient` with the correct callback URL
- (If middleware enabled) A `Middleware`, `Password` generator, and `ExternalSecret`
- (If middleware enabled) An `HTTPRoute` with an `ExtensionRef` filter referencing `oidc-auth`

## Secrets

The modifier creates two secrets per app (when middleware is enabled):

| Secret | Created by | Keys |
|---|---|---|
| `<app>-oidc-credentials` | pocket-id-operator | `client_id`, `client_secret`, `issuer_url`, and OIDC endpoint URLs |
| `<app>-oidc-plugin` | External Secrets | `plugin-secret` (32-char session encryption key) |

Without middleware, only `<app>-oidc-credentials` is created (by the operator).

## Prerequisites

- The pocket-id-operator must be installed (see `apps/pocket-id.ts`)
- The External Secrets operator must be installed (see `apps/external-secrets.ts`) — only needed for middleware mode
- The Traefik OIDC plugin must be declared in `cluster/traefik-config.yaml` — only needed for middleware mode

## Reference

| Component | Location |
|---|---|
| `withOidcAuth()` modifier | `modifiers.ts` |
| `forwardAuth` type field | `types.ts` (`WorkloadApp`) |
| `ExtensionRef` filter logic | `utils.ts` (`buildRoute()`) |
| Traefik plugin declaration | `cluster/traefik-config.yaml` |
| Pocket ID operator app | `apps/pocket-id.ts` |
