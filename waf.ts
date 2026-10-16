import { Middleware } from "@kubernetes-models/traefik/traefik.io/v1alpha1/Middleware";

export const crowdsecNamespace = "crowdsec";

export const crowdsecKeysSecretName = "crowdsec-keys";
export const bouncerKeyName = "BOUNCER_KEY_traefik";

// The Middleware CRD has no secretKeyRef, so Traefik mounts the key and reads it from a file.
export const bouncerKeySecretNamespace = "kube-system";
export const bouncerKeySecretName = "crowdsec-bouncer-key";
export const bouncerKeyMountDir = "/etc/traefik/crowdsec";

export const crowdsecLapiHost = `crowdsec-service.${crowdsecNamespace}.svc.cluster.local:8080`;

// Must match `experimental.plugins.<name>` in cluster/traefik-config.yaml.
const BOUNCER_PLUGIN_NAME = "crowdsec-bouncer";

export const WAF_MIDDLEWARE_NAME = "crowdsec-appsec";

export type WafProfile = {
	// Each AppSec acquisition runs its own HTTP server, so every profile needs its own port.
	port: number;
	appsecConfigs: readonly string[];
	collections: readonly string[];
};

// `crs` runs the OWASP CRS out-of-band (alerts and bans only); `crs-inband` blocks on it.
export const wafProfiles = {
	default: {
		port: 7422,
		appsecConfigs: ["crowdsecurity/appsec-default", "crowdsecurity/crs"],
		collections: [
			"crowdsecurity/appsec-virtual-patching",
			"crowdsecurity/appsec-generic-rules",
			"crowdsecurity/appsec-crs",
		],
	},
	strict: {
		port: 7423,
		appsecConfigs: [
			"crowdsecurity/appsec-default",
			"crowdsecurity/crs-inband",
		],
		collections: [
			"crowdsecurity/appsec-virtual-patching",
			"crowdsecurity/appsec-generic-rules",
			"crowdsecurity/appsec-crs-inband",
		],
	},
} as const satisfies Record<string, WafProfile>;

export type WafProfileName = keyof typeof wafProfiles;

export const DEFAULT_WAF_PROFILE: WafProfileName = "default";

export type WafOptions = {
	exempt?: never;
	profile?: WafProfileName;
	bodyLimit?: number;
};

export type WafExemption = {
	exempt: string;
};

export type WafSetting = WafOptions | WafExemption;

export type ResolvedWaf = {
	profile: WafProfileName;
	bodyLimit?: number;
};

export function wafAppsecServiceName(profile: string): string {
	return `crowdsec-appsec-${profile}`;
}

function appsecHost(profile: WafProfileName): string {
	return `${wafAppsecServiceName(profile)}.${crowdsecNamespace}.svc.cluster.local:${wafProfiles[profile].port}`;
}

// External routes get the WAF unless exempted with a reason; `undefined` means no WAF applies.
export function resolveWaf(
	appName: string,
	externallyAccessible: boolean | undefined,
	waf: WafSetting | undefined,
): ResolvedWaf | undefined {
	if (!externallyAccessible) {
		if (waf !== undefined) {
			throw new Error(
				`App '${appName}' sets waf but is not externallyAccessible`,
			);
		}
		return undefined;
	}

	if (waf?.exempt !== undefined) {
		if (waf.exempt.trim() === "") {
			throw new Error(`App '${appName}' waf exemption needs a reason`);
		}
		return undefined;
	}

	return {
		profile: waf?.profile ?? DEFAULT_WAF_PROFILE,
		bodyLimit: waf?.bodyLimit,
	};
}

// Trusted clients skip every check, so a misread forwarded header can't ban cloudflared's pod IP.
const TRUSTED_CLIENT_CIDRS = ["10.42.0.0/16", "10.43.0.0/16", "192.168.0.0/16"];

// Must match `entryPoints.https.forwardedHeaders.trustedIPs` in cluster/traefik-config.yaml.
const TRUSTED_PROXY_CIDRS = ["10.42.0.0/16"];

// Fails open on AppSec/LAPI errors so a restarting AppSec pod can't take every public app down.
export function buildWafMiddleware({
	profile,
	bodyLimit,
}: ResolvedWaf): Middleware {
	return new Middleware({
		metadata: { name: WAF_MIDDLEWARE_NAME },
		spec: {
			plugin: {
				[BOUNCER_PLUGIN_NAME]: {
					enabled: true,
					crowdsecMode: "stream",
					crowdsecLapiScheme: "http",
					crowdsecLapiHost,
					crowdsecLapiKeyFile: `${bouncerKeyMountDir}/${bouncerKeyName}`,
					updateMaxFailure: -1,
					streamStartupBlock: false,
					crowdsecAppsecEnabled: true,
					crowdsecAppsecHost: appsecHost(profile),
					crowdsecAppsecFailureBlock: false,
					crowdsecAppsecUnreachableBlock: false,
					crowdsecAppsecUnreadableBodyBlock: false,
					...(bodyLimit !== undefined && {
						crowdsecAppsecBodyLimit: bodyLimit,
					}),
					forwardedHeadersTrustedIps: TRUSTED_PROXY_CIDRS,
					clientTrustedIps: TRUSTED_CLIENT_CIDRS,
				},
			},
		},
	});
}
