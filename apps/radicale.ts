import { applyModifiers, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildGeneratedSecret, readFile, image } from "../utils";
import { httpCheck, readiness } from "../probes";

const name = "radicale";
const usersSecretName = `${name}-users`;

const radicaleConfig = await readFile(
	"./radicale/radicale.conf",
	import.meta.url,
);

const base: WorkloadApp = {
	kind: "workload",
	name,
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("radicale"),
				env: [
					{ name: "RADICALE_CONFIG", value: radicaleConfig },
					{
						name: "RADICALE_USERS",
						valueFrom: {
							secretKeyRef: {
								name: usersSecretName,
								key: "users",
							},
						},
					},
				],
				ports: [{ name: "http", containerPort: 5232 }],
				securityContext: {
					allowPrivilegeEscalation: false,
					readOnlyRootFilesystem: true,
					capabilities: {
						drop: ["ALL"],
					},
				},
				livenessProbe: {
					httpGet: {
						path: "/",
						port: 5232,
					},
					periodSeconds: 30,
					failureThreshold: 3,
				},
				readinessProbe: readiness(httpCheck("/", 5232)),
			},
		],
	},
	webPort: 5232,
	externallyAccessible: true,
	extraResources: buildGeneratedSecret(name, usersSecretName, ["password"], {
		template: {
			engineVersion: "v2",
			data: {
				users: '{{ htpasswd "aaron" .password "bcrypt" }}',
				password: "{{ .password }}",
			},
		},
	}),
};

export default applyModifiers(
	base,
	withNasMounts({
		main: [
			{
				mountPath: "/radicale/var",
				subPath: "radicale/data/collections",
			},
		],
	}),
);
