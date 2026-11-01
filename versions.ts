// Renovate parses this file with regex managers that depend on the exact field
// order and one-entry-per-object shape below. Do not reformat, reorder fields,
// or introduce computed values, template strings or shared constants for
// names and tags.

export type ImageRegistry =
  | "docker.io"
  | "ghcr.io"
  | "quay.io"
  | "registry.k8s.io"
  | "docker.dragonflydb.io";

export type ImageEntry = {
  readonly name: `${ImageRegistry}/${string}`;
  readonly tag: string;
  /** true: pulled via the zot.int.lab53.net pull-through mirror */
  readonly mirrored: boolean;
};

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
  transmission: {
    name: "docker.io/haugene/transmission-openvpn",
    tag: "5.5.2",
    mirrored: true,
  },
  sublime: {
    name: "ghcr.io/aaronkyriesenbach/sublime",
    tag: "0.4.0",
    mirrored: true,
  },
  whisperCpp: {
    name: "ghcr.io/ggml-org/whisper.cpp",
    tag: "main-c62adfbd1ecdaea9e295c72d672992514a2d887c",
    mirrored: true,
  },
  curl: {
    name: "docker.io/curlimages/curl",
    tag: "8.23.0",
    mirrored: true,
  },
  linkwarden: {
    name: "ghcr.io/linkwarden/linkwarden",
    tag: "v2.16.3",
    mirrored: true,
  },
  trilium: {
    name: "docker.io/triliumnext/trilium",
    tag: "v0.106.1",
    mirrored: true,
  },
  shakedown: {
    name: "ghcr.io/aaronkyriesenbach/shakedown",
    tag: "0.2.0",
    mirrored: true,
  },
  jellyfin: {
    name: "docker.io/jellyfin/jellyfin",
    tag: "12.3",
    mirrored: true,
  },
  radicale: {
    name: "docker.io/11notes/radicale",
    tag: "3.8.3",
    mirrored: true,
  },
  bun: {
    name: "docker.io/oven/bun",
    tag: "1.4.4",
    mirrored: true,
  },
  navidrome: {
    name: "ghcr.io/navidrome/navidrome",
    tag: "0.64.2",
    mirrored: true,
  },
  resticServer: {
    name: "docker.io/restic/rest-server",
    tag: "0.14.0",
    mirrored: true,
  },
  homeAssistant: {
    name: "ghcr.io/home-assistant/home-assistant",
    tag: "2026.10.4",
    mirrored: true,
  },
  dragonfly: {
    name: "docker.dragonflydb.io/dragonflydb/dragonfly",
    tag: "v2.0.2",
    mirrored: true,
  },
  garage: {
    name: "docker.io/dxflrs/garage",
    tag: "v2.5.0",
    mirrored: true,
  },
  typetype: {
    name: "ghcr.io/typetype-video/typetype",
    tag: "1.13.2",
    mirrored: true,
  },
  typetypeServer: {
    name: "ghcr.io/typetype-video/typetype-server",
    tag: "1.14.1",
    mirrored: true,
  },
  typetypeDownloader: {
    name: "ghcr.io/typetype-video/typetype-downloader",
    tag: "1.12.0",
    mirrored: true,
  },
  typetypeToken: {
    name: "ghcr.io/typetype-video/typetype-token",
    tag: "1.11.1",
    mirrored: true,
  },
  immichPostgres: {
    name: "ghcr.io/immich-app/postgres",
    tag: "14-vectorchord0.4.3-pgvectors0.2.0",
    mirrored: true,
  },
  gluetun: {
    name: "docker.io/qmcgaw/gluetun",
    tag: "v3.41.3",
    mirrored: true,
  },
  qbittorrent: {
    name: "docker.io/linuxserver/qbittorrent",
    tag: "5.2.4",
    mirrored: true,
  },
  calino: {
    name: "ghcr.io/ivan-malinovski/calino",
    tag: "0.41.0",
    mirrored: true,
  },
  forscore: {
    name: "ghcr.io/aaronkyriesenbach/forscoreviewer",
    tag: "0.3.0",
    mirrored: true,
  },
  apprise: {
    name: "docker.io/caronc/apprise",
    tag: "2.0.2",
    mirrored: true,
  },
  healthchecks: {
    name: "docker.io/healthchecks/healthchecks",
    tag: "v4.4",
    mirrored: true,
  },
  cloudflared: {
    name: "docker.io/cloudflare/cloudflared",
    tag: "2026.10.3",
    mirrored: true,
  },
  kubeVip: {
    name: "ghcr.io/kube-vip/kube-vip",
    tag: "v1.3.1",
    mirrored: false,
  },
  zot: {
    name: "ghcr.io/project-zot/zot",
    tag: "v2.1.22",
    mirrored: false,
  },
  dispatcharr: {
    name: "ghcr.io/dispatcharr/dispatcharr",
    tag: "0.33.0",
    mirrored: true,
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
} as const satisfies Record<number, ImageEntry>;

export const helmCharts = {
  reloader: {
    kind: "repo",
    repo: "https://stakater.github.io/stakater-charts",
    chart: "reloader",
    version: "2.2.18",
  },
  volsync: {
    kind: "repo",
    repo: "https://backube.github.io/helm-charts",
    chart: "volsync",
    version: "0.17.0",
  },
  externalSecrets: {
    kind: "repo",
    repo: "https://charts.external-secrets.io",
    chart: "external-secrets",
    version: "2.14.0",
  },
  externalDns: {
    kind: "repo",
    repo: "https://kubernetes-sigs.github.io/external-dns/",
    chart: "external-dns",
    version: "1.23.0",
  },
  certManager: {
    kind: "oci",
    chart: "oci://quay.io/jetstack/charts/cert-manager",
    version: "v1.21.3",
  },
  trustManager: {
    kind: "oci",
    chart: "oci://quay.io/jetstack/charts/trust-manager",
    version: "v0.26.0",
  },
  immich: {
    kind: "oci",
    chart: "oci://ghcr.io/immich-app/immich-charts/immich",
    version: "0.13.4",
  },
  crowdsec: {
    kind: "repo",
    repo: "https://crowdsecurity.github.io/helm-charts",
    chart: "crowdsec",
    version: "0.24.2",
  },
  kyoo: {
    kind: "oci",
    chart: "oci://ghcr.io/zoriya/helm-charts/kyoo",
    version: "5.2.1",
  },
  traefik: {
    kind: "repo",
    repo: "https://traefik.github.io/charts",
    chart: "traefik",
    version: "42.1.3",
  },
  authentik: {
    kind: "repo",
    repo: "https://charts.goauthentik.io",
    chart: "authentik",
    version: "2026.8.5",
  },
  victoriaMetricsK8sStack: {
    kind: "repo",
    repo: "https://victoriametrics.github.io/helm-charts/",
    chart: "victoria-metrics-k8s-stack",
    version: "0.96.0",
  },
  opentelemetryCollector: {
    kind: "repo",
    repo: "https://open-telemetry.github.io/opentelemetry-helm-charts",
    chart: "opentelemetry-collector",
    version: "0.177.0",
  },
} as const satisfies Record<string, HelmChartEntry>;

export type ImageKey = keyof typeof images;
export type PostgresMajor = keyof typeof postgresImages;
export type HelmChartKey = keyof typeof helmCharts;
