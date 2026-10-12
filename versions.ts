// Renovate parses this file with regex managers that depend on the exact field
// order and one-entry-per-object shape below. Do not reformat, reorder fields,
// or introduce computed values, template strings or shared constants for
// names and tags.

export type NonHubRegistry = "ghcr.io" | "docker.dragonflydb.io";

type HubImage = {
	readonly name: `docker.io/${string}/${string}`;
	readonly tag: string;
	/** true: pulled via the docker.int.lab53.net pull-through mirror */
	readonly mirrored: boolean;
};

type OtherImage = {
	readonly name: `${NonHubRegistry}/${string}`;
	readonly tag: string;
	readonly mirrored?: never;
};

export type ImageEntry = HubImage | OtherImage;

export type HelmChartEntry =
	| {
			readonly kind: "repo";
			readonly repo: `https://${string}`;
			readonly chart: string;
			readonly version: string;
	  }
	| {
			readonly kind: "oci";
			readonly chart: `oci://${string}`;
			readonly version: string;
	  };

export const images = {
	poznote: {
		name: "ghcr.io/timothepoznanski/poznote",
		tag: "6.19.1",
	},
	transmission: {
		name: "docker.io/haugene/transmission-openvpn",
		tag: "5.4.1",
		mirrored: true,
	},
	sublime: {
		name: "ghcr.io/aaronkyriesenbach/sublime",
		tag: "0.4.0",
	},
	whisperCpp: {
		name: "ghcr.io/ggml-org/whisper.cpp",
		tag: "main-c62adfbd1ecdaea9e295c72d672992514a2d887c",
	},
	curl: {
		name: "docker.io/curlimages/curl",
		tag: "8.12.1",
		mirrored: true,
	},
	miniflux: {
		name: "docker.io/miniflux/miniflux",
		tag: "2.2.19",
		mirrored: true,
	},
	linkwarden: {
		name: "ghcr.io/linkwarden/linkwarden",
		tag: "v2.16.1",
	},
	trilium: {
		name: "docker.io/triliumnext/trilium",
		tag: "v0.104.1",
		mirrored: true,
	},
	shakedown: {
		name: "ghcr.io/aaronkyriesenbach/shakedown",
		tag: "0.1.0",
	},
	openWebui: {
		name: "ghcr.io/open-webui/open-webui",
		tag: "v0.9.6",
	},
	jellyfin: {
		name: "docker.io/jellyfin/jellyfin",
		tag: "10.11.11",
		mirrored: true,
	},
	radicale: {
		name: "docker.io/11notes/radicale",
		tag: "3.7.4",
		mirrored: true,
	},
	ddnsRoute53: {
		name: "docker.io/crazymax/ddns-route53",
		tag: "latest",
		mirrored: true,
	},
	registry: {
		name: "docker.io/library/registry",
		tag: "2",
		mirrored: false,
	},
	bun: {
		name: "docker.io/oven/bun",
		tag: "1.3.14",
		mirrored: true,
	},
	navidrome: {
		name: "ghcr.io/navidrome/navidrome",
		tag: "0.62.0",
	},
	resticServer: {
		name: "docker.io/restic/rest-server",
		tag: "0.14.0",
		mirrored: true,
	},
	homeAssistant: {
		name: "ghcr.io/home-assistant/home-assistant",
		tag: "2026.6.1",
	},
	dragonfly: {
		name: "docker.dragonflydb.io/dragonflydb/dragonfly",
		tag: "v1.39.0",
	},
	garage: {
		name: "docker.io/dxflrs/garage",
		tag: "v2.2.0",
		mirrored: true,
	},
	typetype: {
		name: "ghcr.io/typetype-video/typetype",
		tag: "1.6.0",
	},
	typetypeServer: {
		name: "ghcr.io/typetype-video/typetype-server",
		tag: "1.6.0",
	},
	typetypeDownloader: {
		name: "ghcr.io/typetype-video/typetype-downloader",
		tag: "1.6.0",
	},
	typetypeToken: {
		name: "ghcr.io/typetype-video/typetype-token",
		tag: "1.6.0",
	},
	filebrowserQuantum: {
		name: "ghcr.io/gtsteffaniak/filebrowser",
		tag: "1.3.0-stable",
	},
	immichPostgres: {
		name: "ghcr.io/immich-app/postgres",
		tag: "14-vectorchord0.4.3-pgvectors0.2.0",
	},
	gluetun: {
		name: "docker.io/qmcgaw/gluetun",
		tag: "v3.41.1",
		mirrored: true,
	},
	qbittorrent: {
		name: "docker.io/linuxserver/qbittorrent",
		tag: "5.2.3",
		mirrored: true,
	},
	calino: {
		name: "ghcr.io/ivan-malinovski/calino",
		tag: "0.33.0",
	},
	forscore: {
		name: "ghcr.io/aaronkyriesenbach/forscoreviewer",
		tag: "0.2.0",
	},
} as const satisfies Record<string, ImageEntry>;

export const postgresImages = {
	16: {
		name: "docker.io/library/postgres",
		tag: "16-alpine",
		mirrored: true,
	},
	17: {
		name: "docker.io/library/postgres",
		tag: "17-alpine",
		mirrored: true,
	},
	18: {
		name: "docker.io/library/postgres",
		tag: "18-alpine",
		mirrored: true,
	},
} as const satisfies Record<number, HubImage>;

export const helmCharts = {
	reloader: {
		kind: "repo",
		repo: "https://stakater.github.io/stakater-charts",
		chart: "reloader",
		version: "2.2.12",
	},
	volsync: {
		kind: "repo",
		repo: "https://backube.github.io/helm-charts",
		chart: "volsync",
		version: "0.15.0",
	},
	externalSecrets: {
		kind: "repo",
		repo: "https://charts.external-secrets.io",
		chart: "external-secrets",
		version: "2.3.0",
	},
	externalDns: {
		kind: "repo",
		repo: "https://kubernetes-sigs.github.io/external-dns/",
		chart: "external-dns",
		version: "1.20.0",
	},
	certManager: {
		kind: "oci",
		chart: "oci://quay.io/jetstack/charts/cert-manager",
		version: "v1.20.1",
	},
	trustManager: {
		kind: "oci",
		chart: "oci://quay.io/jetstack/charts/trust-manager",
		version: "v0.22.0",
	},
	pocketIdOperator: {
		kind: "oci",
		chart: "oci://ghcr.io/aclerici38/charts/pocket-id-operator",
		version: "0.7.2",
	},
	immich: {
		kind: "oci",
		chart: "oci://ghcr.io/immich-app/immich-charts/immich",
		version: "0.12.0",
	},
} as const satisfies Record<string, HelmChartEntry>;

export type ImageKey = keyof typeof images;
export type PostgresMajor = keyof typeof postgresImages;
export type HelmChartKey = keyof typeof helmCharts;
