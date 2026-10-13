import { Project } from "../constants";
import type { StaticApp } from "../types";
import { buildDeployment, image, readYaml } from "../utils";

const awsCredentialsSecretName = "aws-credentials";

const ddnsRoute53Deployment = buildDeployment(
	"ddns-route53",
	{
		containers: [
			{
				name: "ddns-route53",
				image: image("ddnsRoute53"),
				env: [
					{
						name: "AWS_ACCESS_KEY_ID",
						valueFrom: {
							secretKeyRef: {
								name: awsCredentialsSecretName,
								key: "access-key-id",
							},
						},
					},
					{
						name: "AWS_SECRET_ACCESS_KEY",
						valueFrom: {
							secretKeyRef: {
								name: awsCredentialsSecretName,
								key: "secret-access-key",
							},
						},
					},
					{
						name: "DDNSR53_ROUTE53_HOSTEDZONEID",
						value: "Z01889102EIVWW3UBDYVL",
					},
					{
						name: "DDNSR53_ROUTE53_RECORDSSET_0_NAME",
						value: "home.lab53.net.",
					},
					{ name: "DDNSR53_ROUTE53_RECORDSSET_0_TYPE", value: "A" },
					{ name: "DDNSR53_ROUTE53_RECORDSSET_0_TTL", value: "300" },
					{ name: "SCHEDULE", value: "*/5 * * * *" },
				],
			},
		],
	},
	{ probeExempt: "cron-style updater with no listener or health endpoint" },
);

const config: StaticApp = {
	kind: "static",
	name: "external-dns",
	project: Project.SYSTEM,
	resources: [ddnsRoute53Deployment],
	helmReleases: [
		{
			chart: "externalDns",
			releaseName: "external-dns-int",
			values: await readYaml(
				"./external-dns/internal-values.yaml",
				import.meta.url,
			),
		},
		{
			chart: "externalDns",
			releaseName: "external-dns-ext",
			skipCrds: true,
			values: await readYaml(
				"./external-dns/external-values.yaml",
				import.meta.url,
			),
		},
	],
};

export default config;
