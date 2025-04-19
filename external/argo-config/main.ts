import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import IngressRoute from "../../shared/IngressRoute.ts";
import Role from "../../shared/Role.ts";
import RoleBinding from "../../shared/RoleBinding.ts";

export class ArgoConfig extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id, { namespace: "argocd" });

    new IngressRoute(this, {
      name: "argocd",
      service: {
        name: "argocd-server",
        port: 443,
      },
      ingressRouteSpec: {
        customHostPrefix: "argo",
        useForwardAuth: false,
        useInsecureTransport: true,
      },
    });

    const execRole = new Role(this, {
      name: "argocd-server-exec",
      rules: [{
        apiGroups: ["*"],
        resources: ["pods/exec"],
        verbs: ["create"],
      }],
    });

    new RoleBinding(this, {
      name: "argocd-server-exec",
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: execRole.name,
      },
      subjects: [{
        kind: "ServiceAccount",
        name: "argocd-server",
        namespace: "argocd",
      }],
    });
  }
}

const app = new Lab53App();
new ArgoConfig(app, "argoconfig");
app.synth();
