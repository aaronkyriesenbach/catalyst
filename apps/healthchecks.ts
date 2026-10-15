import { applyModifiers, withPostgres } from "../modifiers";
import { httpCheck, readiness, startup } from "../probes";
import type { WorkloadApp } from "../types";
import { appUrl, buildGeneratedSecret, image, postgresImage } from "../utils";

const name = "healthchecks";
const port = 8000;
const secretKeyName = `${name}-secret-key`;

export const healthchecksUrl = `http://${name}.${name}.svc:${port}`;

const statusCheck = httpCheck("/api/v3/status/", port);

const base: WorkloadApp = {
	kind: "workload",
	name,
	podSpec: {
		// Any explicit value skips the uid 1000 default; the image runs as `hc`.
		securityContext: { seccompProfile: { type: "RuntimeDefault" } },
		// uWSGI keeps running when the entrypoint's migrate fails and its alert
		// daemons give up, so the pod must not start before Postgres answers.
		initContainers: [
			{
				name: "wait-for-postgres",
				image: postgresImage(17),
				command: ["pg_isready", "-h", `${name}-postgres`, "-U", name],
				securityContext: {
					allowPrivilegeEscalation: false,
					capabilities: { drop: ["ALL"] },
					runAsNonRoot: true,
					runAsUser: 999,
				},
			},
		],
		containers: [
			{
				name: "main",
				image: image("healthchecks"),
				env: [
					{
						name: "SECRET_KEY",
						valueFrom: {
							secretKeyRef: {
								name: secretKeyName,
								key: "secret-key",
							},
						},
					},
					{ name: "DEBUG", value: "False" },
					{ name: "SITE_ROOT", value: appUrl(name) },
					{ name: "SITE_NAME", value: "Catalyst Healthchecks" },
					// In-cluster pings and kubelet probes don't use SITE_ROOT's host.
					{ name: "ALLOWED_HOSTS", value: "*" },
					{ name: "REGISTRATION_OPEN", value: "False" },
					{ name: "EMAIL_USE_VERIFICATION", value: "False" },
					// Webhooks to Apprise target a private cluster IP, blocked by default.
					{ name: "INTEGRATIONS_ALLOW_PRIVATE_IPS", value: "True" },
					{ name: "DB", value: "postgres" },
					{ name: "DB_HOST", value: `${name}-postgres` },
					{ name: "DB_PORT", value: "5432" },
					{ name: "DB_NAME", value: name },
					{ name: "DB_USER", value: name },
					{ name: "DB_PASSWORD", value: name },
				],
				ports: [{ name: "http", containerPort: port }],
				securityContext: {
					allowPrivilegeEscalation: false,
					capabilities: { drop: ["ALL"] },
				},
				startupProbe: startup(statusCheck, 180),
				livenessProbe: {
					...statusCheck,
					periodSeconds: 30,
					failureThreshold: 3,
				},
				readinessProbe: readiness(statusCheck),
			},
		],
	},
	webPort: port,
	// The entrypoint runs `manage.py migrate`; two pods could race on it.
	strategy: { type: "Recreate" },
	extraResources: buildGeneratedSecret(
		name,
		secretKeyName,
		[{ key: "secret-key", length: 50 }],
		{ persist: true },
	),
};

export default applyModifiers(base, withPostgres(17, { backup: true }));
