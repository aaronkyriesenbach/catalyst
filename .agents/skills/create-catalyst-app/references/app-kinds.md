# App Kinds

Catalyst defines three patterns for adding apps to the cluster. Choose based on
what the upstream app provides.

## WorkloadApp

The most common kind. Provide a `podSpec` with containers, and catalyst
auto-generates the Deployment, Service, and HTTPRoute. Use modifiers
(`withNasMounts`, `withPostgres`, `withOidcAuth`, `withIscsiVolumes`) to add
storage, databases, and auth.

**When to use:** The app provides a Docker image and you can describe it with
containers, ports, volumes, and env vars.

**Structure:**

```typescript
import { applyModifiers, withIscsiVolumes } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "my-app",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/org/image:1.0.0",
        ports: [{ name: "http", containerPort: 8080 }],
        env: [
          { name: "CONFIG_VAR", value: "some-value" },
        ],
      },
    ],
  },
  webPort: 8080,
  externallyAccessible: true,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [{ name: "data", mountPath: "/data", backup: true }],
  }),
);
```

**Example — Memos** (`apps/memos.ts`):
A simple web app with iSCSI storage and OIDC auth. No Postgres needed.

**Example — Navidrome** (`apps/navidrome.ts`):
A music server with NAS mounts for music files, iSCSI for its database, and
OIDC auth with custom headers.

**Example — Home Assistant** (`apps/home-assistant.ts`):
Minimal — just a container, port, and iSCSI volume.

## StaticApp

Provides an explicit `resources` array. Nothing is auto-generated — you control
every resource. Often used to wrap a HelmChart.

**When to use:** The app is best installed via a Helm chart, needs custom
resource types, or the auto-generated Deployment/Service/HTTPRoute pattern
doesn't fit.

**Structure:**

```typescript
import type { HelmChart, StaticApp } from "../types";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: { name: "my-app" },
  spec: {
    chart: "oci://ghcr.io/org/charts/my-app",
    targetNamespace: "my-app",
    version: "1.0.0",
  },
};

const config: StaticApp = {
  kind: "static",
  name: "my-app",
  resources: [chart],
};

export default config;
```

**Example — VolSync** (`apps/volsync.ts`):
Simple HelmChart wrapper with a custom namespace.

**Example — Pocket ID** (`apps/pocket-id.ts`):
HelmChart with `valuesContent` loaded from a file, plus backup resources.

**Example — Cert Manager** (`apps/cert-manager.ts`):
HelmChart with `set` for Helm values, plus hand-crafted custom resources from
a subdirectory.

## Choosing Between Them

| Situation | Use |
|---|---|
| App has a Docker image, runs as a single pod | WorkloadApp |
| App needs a database managed by catalyst | WorkloadApp + `withPostgres` |
| App needs OIDC auth | WorkloadApp + `withOidcAuth` |
| Canonical install is a Helm chart | StaticApp + HelmChart |
| Need resources beyond Deployment/Service/HTTPRoute | StaticApp, or WorkloadApp + `extraResources` |
| Multiple related resources from a chart | StaticApp + HelmChart |