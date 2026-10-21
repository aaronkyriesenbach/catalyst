# Forward Auth

Apps are put behind a login with authentik's embedded outpost. An app that runs its own OIDC flow uses `withOidcClient` instead; see [authentik](authentik.md).

## authentik forward auth

Traefik asks the authentik **embedded outpost** (it runs inside the `authentik-server` pods) whether each request is allowed.

```text
browser ─► Traefik ─► [WAF] ─► forward-auth Middleware ──► authentik-server /outpost.goauthentik.io/auth/traefik
                                     │ 200: request continues to the app, with X-authentik-* headers
                                     └ 401/302: redirect to /outpost.goauthentik.io/start on the app's own host
```

`withForwardAuth()` sets `oidc: { kind: "proxy" }` on the app. Nothing else per app is written by hand:

- `renderWorkload` emits one `forward-auth` `Middleware` into the app's namespace. It is identical for every app, because authentik picks the provider from the forwarded host. It has to exist per namespace because an `ExtensionRef` filter can only name a Middleware next to the route.
- `buildRoute` adds the `ExtensionRef` filter and a first rule sending `/outpost.goauthentik.io/` on the app's host to `authentik-server`. Login redirects and the OIDC callback land on the app's own hostname, so this rule is required. The rule carries the WAF filter but not the forward-auth filter.
- `apps/authentik.ts` scans every app for `oidc` declarations and generates, per app, an authentik group, a proxy provider (`forward_single`), an application, and a policy binding that restricts the application to the group. It binds the providers to the embedded outpost and writes a `ReferenceGrant` in the `authentik` namespace so each app's `HTTPRoute` may reference `authentik-server`.

There is no shared secret to create or rotate: the outpost and authentik handle the provider credentials internally.

### Access control

Access is per app. Each app has an authentik group with the app's name, and only members can open it. Declared users get their groups from `apps/authentik/users.config.ts`; anyone else is added to a group in the authentik admin UI.

### Adding forward auth to an app

```typescript
export default applyModifiers(base, withForwardAuth());
```

The app needs a `webPort`. To let paths through without a login, pass regexes the outpost matches:

```typescript
withForwardAuth({ skipPathRegex: ["^/api/webhook$"] });
```

Then add the app's name to the `apps` list of any user in `apps/authentik/users.config.ts` who should have access, and check the output:

```bash
bun run render <app-name>
bun run render authentik
```

The app render should contain a `forward-auth` Middleware and an `HTTPRoute` with the outpost rule and the `ExtensionRef` filter. The authentik render should contain the app's entries in the `catalyst-apps.yaml` blueprint and a `ReferenceGrant` entry for the app's namespace.

### Prerequisites

- The `authentik` app must be installed (`apps/authentik.ts`).
- The authentik hostname is `authentikHostOptions` in `auth.ts`. Changing it regenerates every provider's URLs, the outpost host and each app's issuer.

### Reference

| Component                          | Location                      |
| ---------------------------------- | ----------------------------- |
| `withForwardAuth()` modifier       | `modifiers.ts`                |
| Middleware, URLs, constants        | `auth.ts`                     |
| Route rule and filter logic        | `utils.ts` (`buildRoute()`)   |
| Blueprint generation               | `apps/authentik/blueprint.ts` |
| authentik app and `ReferenceGrant` | `apps/authentik.ts`           |
