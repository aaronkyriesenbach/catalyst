import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";

const argoRoute = new HTTPRoute({
  metadata: {
    name: "argocd",
    namespace: "argocd",
  },
  spec: {
    parentRefs: [
      {
        name: "traefik",
        namespace: "traefik",
      },
    ],
    hostnames: ["argocd.int.lab53.net"],
    rules: [
      {
        backendRefs: [
          {
            name: "argocd-server",
            namespace: "argocd",
            port: 80,
          },
        ],
      },
    ],
  },
});

export const routes = [argoRoute];
