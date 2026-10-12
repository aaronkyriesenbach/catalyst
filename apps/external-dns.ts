import { Project } from "../constants";
import type { StaticApp } from "../types";
import { buildDeployment, readFile, image, buildHelmChart } from "../utils";

const internalChart = buildHelmChart("externalDns", {
	name: "external-dns-int",
	targetNamespace: "external-dns",
	valuesContent: await readFile(
		"./external-dns/internal-values.yaml",
		import.meta.url,
	),
});

const externalChart = buildHelmChart("externalDns", {
	name: "external-dns-ext",
	targetNamespace: "external-dns",
	valuesContent: await readFile(
		"./external-dns/external-values.yaml",
		import.meta.url,
	),
});

const awsCredentialsSecretName = "aws-credentials";

const ddnsRoute53Deployment = buildDeployment("ddns-route53", {
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
});

const config: StaticApp = {
	kind: "static",
	name: "external-dns",
	project: Project.SYSTEM,
	resources: [internalChart, externalChart, ddnsRoute53Deployment],
};

export default config;
