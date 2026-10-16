import { Service } from "kubernetes-models/v1";
import { DOCKER_MIRROR_HOST, Project } from "../constants";
import type { StaticApp } from "../types";
import {
	awsRemoteKey,
	buildAwsExternalSecret,
	buildGeneratedSecret,
	readYaml,
} from "../utils";
import {
	bouncerKeyName,
	bouncerKeySecretName,
	bouncerKeySecretNamespace,
	crowdsecKeysSecretName,
	crowdsecNamespace,
	wafAppsecServiceName,
	wafProfiles,
} from "../waf";

const profiles = Object.entries(wafProfiles);

const alphanumeric = true;

// persist: Traefik's namespace needs the same bouncer key, so it lives in AWS instead of being generated per ExternalSecret.
const keysSecret = buildGeneratedSecret(
	crowdsecNamespace,
	crowdsecKeysSecretName,
	[
		{ key: bouncerKeyName, length: 48, alphanumeric },
		// The chart requires more than 64 and more than 48 characters respectively.
		{ key: "csLapiSecret", length: 72, alphanumeric },
		{ key: "registrationToken", length: 64, alphanumeric },
	],
	{ persist: true },
);

const traefikBouncerKey = buildAwsExternalSecret(
	bouncerKeySecretName,
	[
		{
			remoteKey: awsRemoteKey(crowdsecNamespace, crowdsecKeysSecretName),
			property: bouncerKeyName,
			secretKey: bouncerKeyName,
		},
	],
	{ namespace: bouncerKeySecretNamespace },
);

// The chart only publishes port 7422, so each profile gets its own Service.
const appsecServices = profiles.map(
	([profile, { port }]) =>
		new Service({
			metadata: { name: wafAppsecServiceName(profile) },
			spec: {
				selector: { "k8s-app": "crowdsec", type: "appsec" },
				ports: [{ name: "appsec", port, targetPort: port }],
			},
		}),
);

const collections = [
	...new Set(profiles.flatMap(([, { collections }]) => collections)),
];

const config: StaticApp = {
	kind: "static",
	name: "crowdsec",
	namespace: crowdsecNamespace,
	project: Project.SYSTEM,
	resources: [...keysSecret, traefikBouncerKey, ...appsecServices],
	helmReleases: [
		{
			chart: "crowdsec",
			releaseName: "crowdsec",
			values: {
				...(await readYaml("./crowdsec/values.yaml", import.meta.url)),
				image: {
					repository: `${DOCKER_MIRROR_HOST}/crowdsecurity/crowdsec`,
				},
				appsec: {
					enabled: true,
					acquisitions: profiles.map(
						([, { port, appsecConfigs }]) => ({
							source: "appsec",
							listen_addr: `0.0.0.0:${port}`,
							path: "/",
							appsec_configs: appsecConfigs,
							labels: { type: "appsec" },
						}),
					),
					env: [
						{ name: "COLLECTIONS", value: collections.join(" ") },
					],
					// CRS is memory hungry; the chart default (250Mi) is too small for it.
					resources: {
						requests: { cpu: "100m", memory: "512Mi" },
						limits: { memory: "1Gi" },
					},
				},
			},
		},
	],
};

export default config;
