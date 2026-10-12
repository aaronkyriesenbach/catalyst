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
import { image } from "../utils";

const base: WorkloadApp = {
	kind: "workload",
	name: "my-app",
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("myApp"), // entry in versions.ts `images`
				ports: [{ name: "http", containerPort: 8080 }],
				env: [{ name: "CONFIG_VAR", value: "some-value" }],
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
every resource. Often used to install Helm charts via `helmReleases`.

**When to use:** The app is best installed via a Helm chart, needs custom
resource types, or the auto-generated Deployment/Service/HTTPRoute pattern
doesn't fit.

**Structure:**

```typescript
import type { StaticApp } from "../types";
import { readYaml } from "../utils";

const config: StaticApp = {
	kind: "static",
	name: "my-app",
	// "myApp" is an entry in versions.ts `helmCharts`; the chart installs into
	// the app's namespace (`namespace ?? name`) as a native ArgoCD Helm source.
	helmReleases: [
		{
			chart: "myApp",
			releaseName: "my-app",
			values: await readYaml("./my-app/values.yaml", import.meta.url),
		},
	],
};

export default config;
```

**Example — VolSync** (`apps/volsync.ts`):
Single helm release with a custom namespace.

**Example — Pocket ID** (`apps/pocket-id.ts`):
Helm release with `values` loaded from a file, plus backup resources.

**Example — Cert Manager** (`apps/cert-manager.ts`):
Helm release with `parameters` (`--set`), plus hand-crafted custom resources
from a subdirectory.

## Choosing Between Them

| Situation                                          | Use                                          |
| -------------------------------------------------- | -------------------------------------------- |
| App has a Docker image, runs as a single pod       | WorkloadApp                                  |
| App needs a database managed by catalyst           | WorkloadApp + `withPostgres`                 |
| App needs OIDC auth                                | WorkloadApp + `withOidcAuth`                 |
| Canonical install is a Helm chart                  | StaticApp + `helmReleases`                   |
| Need resources beyond Deployment/Service/HTTPRoute | StaticApp, or WorkloadApp + `extraResources` |
| Multiple related resources from a chart            | StaticApp + `helmReleases`                   |
