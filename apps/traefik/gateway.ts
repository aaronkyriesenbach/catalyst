import { Gateway } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";

export const gateway = new Gateway({
  metadata: {
    name: "traefik",
    annotations: {
      "external-dns.alpha.kubernetes.io/target": "192.168.53.210",
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
