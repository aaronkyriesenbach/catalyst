import { Project } from "@catalyst/core/constants";
import type { Cluster } from "@catalyst/core/types";

const cluster: Cluster = {
  name: "cluster0",
  kind: "standalone",
  network: {
    podCidr: "10.42.0.0/16",
    serviceCidr: "10.43.0.0/16",
    vips: { api: "192.168.53.200", gateway: "192.168.53.201" },
  },
  edge: { cloudflareTunnelId: "50e30bc4-339f-4bba-a3ff-3c780467ecf8" },
  gitops: {
    projects: {
      [Project.SYSTEM]: {
        description: "Cluster infrastructure components",
        sourceRepos: ["*"],
        destinations: [
          { server: "https://kubernetes.default.svc", namespace: "*" },
        ],
        clusterResourceWhitelist: [{ group: "*", kind: "*" }],
      },
    },
    unmanagedNamespaces: ["argocd", "default", "kube-system"],
    unmirroredChartImages: [
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
    ],
  },
};

export default cluster;
