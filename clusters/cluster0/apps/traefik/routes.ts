import { buildRoute } from "@catalyst/k8s/route";

const argoRoute = buildRoute("argocd", 80, {
  serviceName: "argocd-server",
  namespace: "argocd",
});

export const routes = [argoRoute];
