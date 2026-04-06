import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";

export const httpRedirect = new HTTPRoute({
  metadata: {
    name: "http-redirect",
    annotations: {
      "external-dns.alpha.kubernetes.io/gateway-hostname-source":
        "defined-hosts-only",
    },
  },
  spec: {
    parentRefs: [
      {
        name: "traefik",
        sectionName: "http",
      },
    ],
    rules: [
      {
        filters: [
          {
            type: "RequestRedirect",
            requestRedirect: {
              scheme: "https",
              statusCode: 301,
            },
          },
        ],
      },
    ],
  },
});
