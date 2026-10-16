import { ClusterIssuer } from "@kubernetes-models/cert-manager/cert-manager.io/v1";

const solvers = [
	{
		dns01: {
			cloudflare: {
				apiTokenSecretRef: {
					name: "cloudflare-api-token",
					key: "api-token",
				},
			},
		},
	},
];

const stagingIssuer = new ClusterIssuer({
	metadata: {
		name: "letsencrypt-staging",
	},
	spec: {
		acme: {
			server: "https://acme-staging-v02.api.letsencrypt.org/directory",
			privateKeySecretRef: {
				name: "letsencrypt-staging-key",
			},
			solvers,
		},
	},
});

const prodIssuer = new ClusterIssuer({
	metadata: {
		name: "letsencrypt-prod",
	},
	spec: {
		acme: {
			server: "https://acme-v02.api.letsencrypt.org/directory",
			privateKeySecretRef: {
				name: "letsencrypt-prod-key",
			},
			solvers,
		},
	},
});

export const issuers = [stagingIssuer, prodIssuer];
