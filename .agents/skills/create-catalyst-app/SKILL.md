---
name: create-catalyst-app
description: >
  Create a new app in the catalyst cluster repository. Use when the user asks
  to create, add, scaffold, or deploy a new app, service, or workload on the
  cluster. Covers all three app kinds — WorkloadApp, StaticApp, HelmChart —
  and auto-discovers the app's recommended installation method before adapting
  it to catalyst's conventions.
---

# Create Catalyst App

Scaffold a complete, deployable app in the catalyst repo. Research the upstream
app's recommended production-ready installation, then adapt it to catalyst's
AppConfig patterns, deferring to the user for conflicts or unresolved questions.

## Workflow

### 1. Understand the Request

From the user's prompt, extract:
- **App name** — the upstream project to deploy (e.g. "Gitea", "Plausible")
- **Any constraints they mention** — specific version, port, domain, auth requirements

### 2. Research the Upstream App

Research the app's recommended production-ready Kubernetes installation. Look
for (in any order):

- Official Helm chart (ArtifactHub / GitHub releases)
- Official Docker image and recommended `docker run` / Docker Compose example
- Project docs for Kubernetes deployment instructions

Extract from the research:
- **Image** — the canonical container image and tag
- **Ports** — which port(s) the app listens on
- **Volumes** — what persistent storage it needs and at what mount paths
- **Environment variables** — required or recommended env vars for production
- **Database** — whether it needs Postgres (and which version)
- **Sign-in / auth** — whether it supports header-based auth (for OIDC forwarding)
- **Helm chart** — whether a Helm chart exists (for StaticApp/HelmChart)

### 3. Choose the App Kind

Decide which `AppConfig` kind fits best. Read
[references/app-kinds.md](references/app-kinds.md) for details and examples.

| Signal | Kind |
|---|---|
| Simple container with ports, volumes, env vars | **WorkloadApp** |
| Needs a Helm chart (no good Docker image, or chart is the canonical install) | **StaticApp** + `HelmChart` |
| Custom resources beyond Deployment/Service/HTTPRoute | **StaticApp** |

### 4. Map to Catalyst Conventions

Translate the upstream setup into catalyst-specific patterns:

| Upstream concept | Catalyst pattern |
|---|---|
| `docker run -p 8080:8080` | `ports: [{ name: "http", containerPort: 8080 }]`, `webPort: 8080` |
| `docker run -v /data` | `withIscsiVolumes({ main: [{ name: "data", mountPath: "/data" }] })` |
| `-e DATABASE_URL=postgres://...` | `withPostgres(17)` — see [references/modifiers.md](references/modifiers.md) |
| `docker run your/image:1.2.3` | Docker Hub → `docker.int.lab53.net/library/...`, otherwise use as-is |
| Sign-in page in the app | `withOidcAuth({ middleware: { enabled: true, headers: [...] } })` |
| Config files | `buildFileConfigMap(...)` and volume mount |
| Arbitrary k8s resources | `extraResources` on a WorkloadApp, or use a StaticApp |

### 5. Resolve Conflicts with the User

When the upstream setup conflicts with catalyst conventions or there are
multiple valid approaches, present the decision to the user. Examples:

- An app needs a `LoadBalancer` Service — catalyst uses HTTPRoute, not LoadBalancer. Propose the catalyst equivalent.
- An app's Helm chart sets `ingress.enabled: true` — that's upstream's concern; disable it and let catalyst's HTTPRoute handle routing.
- An app needs a database but the upstream uses MySQL. Propose `withPostgres` as the catalyst-standard alternative.
- Upstream uses ports the user hasn't specified — ask which are needed.

### 6. Scaffold the App

Write the app file at `apps/<name>.ts` following the chosen kind's pattern.

**WorkloadApp checklist:**
- `kind: "workload"`, `name`, `podSpec` with containers
- `webPort` set if the app has an HTTP interface
- `externallyAccessible: true` if it should be reachable outside the LAN
- `subDomain` if the hostname should differ from the app name
- Default export: `export default applyModifiers(base, ...modifiers)`
- Containers named `"main"`

**StaticApp checklist:**
- `kind: "static"`, `name`, `resources` array
- Each resource is an instantiated k8s model or a plain object
- HelmChart resources use `await readFile(...)` for `valuesContent`

If the app needs a subdirectory (e.g. `apps/<name>/values.yaml`), create it.
If files go into a ConfigMap, use `buildFileConfigMap(name, files)` —
**not** raw `data:` — to avoid CMP `$` substitution.

### 7. Validate

Run the render to confirm the YAML output is valid:

```bash
bun run render <app-name>
```

If it fails, read the error, fix, and re-render. Do not proceed until it passes.

## Gotchas

The AGENTS.md covers general conventions (image mirroring, default export,
CMP `$` substitution, security context). Read that first. These are additional
gotchas specific to scaffold decisions:

- **`withIscsiVolumes` forces `Recreate` strategy.** If the app needs `RollingUpdate`, use `withNasMounts` instead.
- **Postgres images come from `docker.int.lab53.net/library/postgres`** — this is the Docker Hub mirror path, not ghcr.io.
- **Modifier container names must match exactly.** If `podSpec.containers[0].name` is `"main"`, the modifier key must also be `"main"`. Mismatches throw at render time, not at build time.

## Reference Files

- [references/app-kinds.md](references/app-kinds.md) — decision guide: when to use each kind, with code structures and example app pointers
- [references/modifiers.md](references/modifiers.md) — field reference for `withIscsiVolumes`, `withNasMounts`, `withPostgres`, `withOidcAuth`