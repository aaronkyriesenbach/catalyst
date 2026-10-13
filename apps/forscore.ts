import { applyModifiers, withNasMounts, withOidcAuth } from "../modifiers";
import { httpCheck, readiness } from "../probes";
import type { WorkloadApp } from "../types";
import { image } from "../utils";

const base: WorkloadApp = {
	kind: "workload",
	name: "forscore",
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("forscore"),
				ports: [{ name: "http", containerPort: 3000 }],
				readinessProbe: readiness(httpCheck("/health", 3000)),
			},
		],
	},
	webPort: 3000,
	externallyAccessible: true,
};

export default applyModifiers(
	base,
	withNasMounts({
		main: [{ mountPath: "/data", subPath: "forscore" }],
	}),
	withOidcAuth({ middleware: { enabled: true } }),
);
