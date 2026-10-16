import { buildRoute } from "../../utils";

const argoRoute = buildRoute("argocd", 80, {
  serviceName: "argocd-server",
  namespace: "argocd",
});

export const routes = [argoRoute];
