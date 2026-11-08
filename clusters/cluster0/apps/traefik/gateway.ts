import { Gateway } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { cluster } from "@catalyst/core/cluster";

const tunnelTarget = `${cluster.edge.cloudflareTunnelId}.cfargotunnel.com`;

export const internalGateway = new Gateway({
  metadata: {
    name: "traefik-internal",
    annotations: {
      "external-dns.kubernetes.io/target": cluster.network.vips.gateway,
    },
  },
  spec: {
    gatewayClassName: "traefik",
    listeners: [
      {
        name: "http",
        protocol: "HTTP",
        port: 80,
      },
      {
        name: "https-int",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.int.lab53.net",
        allowedRoutes: {
          namespaces: {
            from: "All",
          },
        },
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "int-lab53-net-prod",
            },
          ],
        },
      },
      {
        name: "https-ext",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.lab53.net",
        allowedRoutes: {
          namespaces: {
            from: "All",
          },
        },
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "lab53-net-prod",
            },
          ],
        },
      },
    ],
  },
});

export const externalGateway = new Gateway({
  metadata: {
    name: "traefik-external",
    annotations: {
      "external-dns.kubernetes.io/target": tunnelTarget,
    },
  },
  spec: {
    gatewayClassName: "traefik",
    listeners: [
      {
        name: "http",
        protocol: "HTTP",
        port: 80,
      },
      {
        name: "https",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.lab53.net",
        allowedRoutes: {
          namespaces: {
            from: "All",
          },
        },
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "lab53-net-prod",
            },
          ],
        },
      },
    ],
  },
});
