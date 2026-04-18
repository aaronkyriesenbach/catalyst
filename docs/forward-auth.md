# Forward Auth (OIDC)

OIDC-based authentication for apps using [traefik-oidc-auth](https://github.com/sevensolutions/traefik-oidc-auth) and [Pocket ID](https://auth.lab53.net/).

## How it works

1. The `withOidcAuth()` modifier adds a Traefik `Middleware` CRD to the app's `extraResources` and sets `forwardAuth: true`
2. `forwardAuth: true` causes `buildRoute()` to add an `ExtensionRef` filter to the HTTPRoute, pointing at the middleware
3. Traefik intercepts requests, redirects unauthenticated users to Pocket ID, and passes authenticated requests through

Session cookies are scoped to `.lab53.net`, so a single login covers all protected apps (SSO).

## Adding OIDC auth to an app

### 1. Import and apply the modifier

```typescript
import { applyModifiers, withOidcAuth } from "../modifiers";

const base: WorkloadApp = {
  kind: "workload",
  name: "my-app",
  // ...
  externallyAccessible: true,
};

export default applyModifiers(base, withOidcAuth());
```

`withOidcAuth()` composes with other modifiers in any order:

```typescript
export default applyModifiers(
  base,
  withSecurityDefaults(),
  withPostgres(18),
  withOidcAuth(),
);
```

### 2. Create the `oidc-auth` Secret in the app's namespace

The middleware reads credentials from a Kubernetes Secret named `oidc-auth` in the same namespace as the app. Each protected app namespace needs its own copy.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oidc-auth
  namespace: <app-namespace>  # defaults to app name
type: Opaque
stringData:
  plugin-secret: "<exactly 32 characters, used for session encryption>"
  client-id: "<OIDC client ID from Pocket ID>"
  client-secret: "<OIDC client secret from Pocket ID>"
```

All apps share the same Pocket ID OIDC client. The client must have a callback URL entry for each protected app:

```
https://<app-subdomain>.lab53.net/oidc/callback
```

### 3. Verify the rendered output

```bash
bun run render <app-name>
```

Confirm the output includes:

- A `traefik.io/v1alpha1 Middleware` resource named `oidc-auth`
- An `HTTPRoute` with a `filters` entry of type `ExtensionRef` referencing `oidc-auth`

## Prerequisites

The Traefik plugin must be declared in the cluster's static config (`cluster/traefik-config.yaml`). This is already done:

```yaml
experimental:
  plugins:
    traefik-oidc-auth:
      moduleName: "github.com/sevensolutions/traefik-oidc-auth"
      version: "v0.19.0"
```

Traefik downloads the plugin at startup. If the version is bumped here, Traefik pods must be restarted.

## Pocket ID client setup

1. Log in to [Pocket ID](https://auth.lab53.net/)
2. Create one OIDC client (or reuse the existing shared client)
3. Add a callback URL for each app: `https://<subdomain>.lab53.net/oidc/callback`
4. Copy the client ID and client secret into the `oidc-auth` Secret for each app namespace

## Reference

| Component | Location |
|---|---|
| `withOidcAuth()` modifier | `modifiers.ts` |
| `forwardAuth` type field | `types.ts` (`WorkloadApp`) |
| `ExtensionRef` filter logic | `utils.ts` (`buildRoute()`) |
| Traefik plugin declaration | `cluster/traefik-config.yaml` |
| Example usage | `apps/invidious.ts` |
