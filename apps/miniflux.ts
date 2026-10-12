import { applyModifiers, withOidcAuth, withPostgres } from "../modifiers";
import type { WorkloadApp } from "../types";
import { image } from "../utils";

const name = "miniflux";
const oidcCredentialsSecret = `${name}-oidc-credentials`;

const base: WorkloadApp = {
	kind: "workload",
	name,
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("miniflux"),
				env: [
					{
						name: "DATABASE_URL",
						value: "postgres://miniflux:miniflux@miniflux-postgres:5432/miniflux?sslmode=disable",
					},
					{ name: "BASE_URL", value: "https://miniflux.lab53.net" },
					{ name: "RUN_MIGRATIONS", value: "true" },
					{ name: "OAUTH2_PROVIDER", value: "oidc" },
					{
						name: "OAUTH2_OIDC_DISCOVERY_ENDPOINT",
						value: "https://auth.lab53.net",
					},
					{
						name: "OAUTH2_CLIENT_ID",
						valueFrom: {
							secretKeyRef: {
								name: oidcCredentialsSecret,
								key: "client_id",
							},
						},
					},
					{
						name: "OAUTH2_CLIENT_SECRET",
						valueFrom: {
							secretKeyRef: {
								name: oidcCredentialsSecret,
								key: "client_secret",
							},
						},
					},
					{
						name: "OAUTH2_REDIRECT_URL",
						value: "https://miniflux.lab53.net/oauth2/oidc/callback",
					},
					{ name: "OAUTH2_USER_CREATION", value: "true" },
					{ name: "DISABLE_LOCAL_AUTH", value: "true" },
				],
				ports: [{ name: "http", containerPort: 8080 }],
				livenessProbe: {
					httpGet: { path: "/healthcheck", port: 8080 },
					initialDelaySeconds: 10,
					periodSeconds: 30,
					failureThreshold: 3,
				},
				readinessProbe: {
					httpGet: { path: "/healthcheck", port: 8080 },
					periodSeconds: 10,
					failureThreshold: 3,
				},
			},
		],
	},
	webPort: 8080,
	externallyAccessible: true,
};

export default applyModifiers(
	base,
	withPostgres(18, { backup: true }),
	withOidcAuth(),
);
