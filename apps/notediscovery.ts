import { applyModifiers, withIscsiVolumes, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
	kind: "workload",
	name: "notediscovery",
	podSpec: {
		containers: [
			{
				name: "main",
				image: "ghcr.io/gamosoft/notediscovery:latest",
				ports: [{ name: "http", containerPort: 8000 }],
				env: [{ name: "TZ", value: "UTC" }],
			},
		],
	},
	webPort: 8000,
	externallyAccessible: true,
};

export default applyModifiers(
	base,
	withIscsiVolumes({
		main: [{ name: "data", mountPath: "/app/data", backup: true }],
	}),
	withOidcAuth({
		middleware: {
			enabled: true,
		},
	}),
);
