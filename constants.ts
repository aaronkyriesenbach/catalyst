import type { ProjectSpec } from "./types";
import type { ImageRegistry } from "./versions";

export const MIRROR_HOST = "zot.int.lab53.net";

// Must match the sync `destination` of each upstream in apps/zot/config.json.
export const mirrorPrefixes: Record<ImageRegistry, string> = {
  "docker.io": "docker",
  "ghcr.io": "ghcr",
  "quay.io": "quay",
  "registry.k8s.io": "k8s",
  "docker.dragonflydb.io": "dragonfly",
};

export type UnmirroredChartImage = {
  release: string;
  repository: string;
  reason: string;
};

// Images zot's own startup depends on, so they must pull straight from upstream.
export const unmirroredChartImages: readonly UnmirroredChartImage[] = [
  {
    release: "traefik",
    repository: "docker.io/traefik",
    reason: "Serves zot; a restarted pod could not pull its own image.",
  },
  {
    release: "external-secrets",
    repository: "ghcr.io/external-secrets/",
    reason: "Creates the bouncer-key Secret Traefik's pods wait for.",
  },
  {
    release: "cert-manager",
    repository: "quay.io/jetstack/cert-manager-",
    reason: "Issues and renews the gateway certificate zot is served with.",
  },
  {
    release: "external-dns-int",
    repository: "registry.k8s.io/external-dns/",
    reason: "Publishes the zot.int.lab53.net DNS record in UniFi.",
  },
  {
    release: "external-dns-int",
    repository: "ghcr.io/home-operations/external-dns-unifi-webhook",
    reason: "Publishes the zot.int.lab53.net DNS record in UniFi.",
  },
];

export enum Project {
  SYSTEM = "system",
}

// `default` is created by ArgoCD's controller and must not be generated here.
export const projectDefinitions: Record<Project, ProjectSpec> = {
  [Project.SYSTEM]: {
    description: "Cluster infrastructure components",
    sourceRepos: ["*"],
    destinations: [
      { server: "https://kubernetes.default.svc", namespace: "*" },
    ],
    clusterResourceWhitelist: [{ group: "*", kind: "*" }],
  },
};

// Namespaces of releases adopted from live installs; moving an app would
// otherwise silently reinstall the chart elsewhere.
export const helmReleaseNamespaces: Record<string, string> = {
  reloader: "reloader",
  volsync: "volsync-system",
  "external-dns-int": "external-dns",
  "external-dns-ext": "external-dns",
  "cert-manager": "cert-manager",
  "trust-manager": "cert-manager",
  "external-secrets": "external-secrets",
  immich: "immich",
  "pocket-id-operator": "pocket-id",
};

// Not secrets: the tunnel UUID is only usable by DNS records in this Cloudflare account.
export const cloudflareZoneId = "6383809236b97157242971dbb4160888";
export const cloudflareTunnelId = "50e30bc4-339f-4bba-a3ff-3c780467ecf8";
export const cloudflareTunnelTarget = `${cloudflareTunnelId}.cfargotunnel.com`;
