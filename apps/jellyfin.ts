import {
	applyModifiers,
	withIscsiVolumes,
	withNasMounts,
	withOidcAuth,
} from "../modifiers";
import type { WorkloadApp } from "../types";
import { image } from "../utils";

const base: WorkloadApp = {
	kind: "workload",
	name: "jellyfin",
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("jellyfin"),
				ports: [{ name: "http", containerPort: 8096 }],
			},
		],
	},
	webPort: 8096,
	externallyAccessible: true,
};

export default applyModifiers(
	base,
	withIscsiVolumes({
		main: [
			{
				name: "config",
				mountPath: "/config",
				storageRequest: "10Gi",
				backup: true,
			},
			{ name: "cache", mountPath: "/cache", storageRequest: "50Gi" },
		],
	}),
	withNasMounts({
		main: [
			{ mountPath: "/movies", subPath: "movies" },
			{ mountPath: "/tv", subPath: "tv" },
			{ mountPath: "/live", subPath: "live" },
		],
	}),
	withOidcAuth(),
);
