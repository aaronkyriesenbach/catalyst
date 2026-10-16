import { stringify } from "yaml";
import { cloudflareTunnelId, Project } from "../constants";
import { httpCheck, readiness } from "../probes";
import type { StaticApp } from "../types";
import {
	awsRemoteKey,
	buildAwsExternalSecret,
	buildDeployment,
	buildFileConfigMap,
	image,
} from "../utils";

const name = "cloudflared";
const credentialsSecretName = "cloudflared-credentials";
const metricsPort = 2000;

const traefikOrigin = "https://traefik.kube-system.svc.cluster.local:443";

const tunnelConfig = {
	tunnel: cloudflareTunnelId,
	"credentials-file": "/etc/cloudflared/credentials/credentials.json",
	metrics: `0.0.0.0:${metricsPort}`,
	// Traefik picks its certificate by SNI, so SNI has to follow the requested host rather than the Service name.
	originRequest: { matchSNItoHost: true },
	// Rules match top to bottom. Internal names never get public DNS records, so this deny rule is a backstop.
	ingress: [
		{ hostname: "*.int.lab53.net", service: "http_status:404" },
		{ hostname: "*.lab53.net", service: traefikOrigin },
		{ service: "http_status:404" },
	],
};

const configMap = buildFileConfigMap(name, {
	"config.yml": stringify(tunnelConfig),
});

const credentialsSecret = buildAwsExternalSecret(credentialsSecretName, [
	{
		remoteKey: awsRemoteKey(name, "tunnel-credentials"),
		secretKey: "credentials.json",
	},
]);

const deployment = buildDeployment(
	name,
	{
		securityContext: {
			runAsNonRoot: true,
			runAsUser: 65532,
			runAsGroup: 65532,
		},
		containers: [
			{
				name,
				image: image("cloudflared"),
				args: [
					"tunnel",
					"--config",
					"/etc/cloudflared/config/config.yml",
					"run",
				],
				ports: [{ name: "metrics", containerPort: metricsPort }],
				readinessProbe: readiness(httpCheck("/ready", metricsPort)),
				livenessProbe: {
					...httpCheck("/ready", metricsPort),
					periodSeconds: 30,
					failureThreshold: 3,
				},
				resources: {
					requests: { cpu: "50m", memory: "64Mi" },
					limits: { memory: "256Mi" },
				},
				securityContext: {
					allowPrivilegeEscalation: false,
					readOnlyRootFilesystem: true,
					capabilities: { drop: ["ALL"] },
				},
				volumeMounts: [
					{
						name: "config",
						mountPath: "/etc/cloudflared/config",
						readOnly: true,
					},
					{
						name: "credentials",
						mountPath: "/etc/cloudflared/credentials",
						readOnly: true,
					},
				],
			},
		],
		volumes: [
			{ name: "config", configMap: { name } },
			{
				name: "credentials",
				secret: { secretName: credentialsSecretName },
			},
		],
		topologySpreadConstraints: [
			{
				maxSkew: 1,
				topologyKey: "kubernetes.io/hostname",
				whenUnsatisfiable: "ScheduleAnyway",
				labelSelector: { matchLabels: { app: name } },
			},
		],
	},
	{ replicas: 2 },
);

const config: StaticApp = {
	kind: "static",
	name,
	project: Project.SYSTEM,
	resources: [configMap, credentialsSecret, deployment],
};

export default config;
