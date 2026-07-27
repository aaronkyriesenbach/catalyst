import { applyModifiers, withIscsiVolumes } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
	kind: "workload",
	name: "trilium",
	podSpec: {
		containers: [
			{
				name: "main",
				image: "docker.int.lab53.net/triliumnext/trilium:v0.104.1",
				ports: [{ name: "http", containerPort: 8080 }],
				env: [{ name: "TRILIUM_DATA_DIR", value: "/home/node/trilium-data" }, { name: "TRILIUM_PORT", value: "8080"}],
			},
		],
		// Standard image's entrypoint (start-docker.sh) chowns /home/node and su's to
		// the "node" user at runtime, which requires root. The published "rootless"
		// tag documented upstream does not actually exist on Docker Hub yet
		// (see https://github.com/TriliumNext/Trilium/issues/8734) — switch to it
		// once TriliumNext publishes it and re-enable the default non-root securityContext.
		securityContext: {},
	},
	webPort: 8080,
	externallyAccessible: true,
};

export default applyModifiers(
	base,
	withIscsiVolumes({
		main: [
			{
				name: "data",
				mountPath: "/home/node/trilium-data",
				storageRequest: "5Gi",
				backup: true,
			},
		],
	}),
);
