import {
  httpTarget,
  routeTargets,
  serviceUrl,
  StatusGroup,
  tcpTarget,
  titleCase,
  type StatusTarget,
} from "../../status";
import { externalApps } from "./externalApps.config";

const NFS_PORT = 2049;

const externalAppTargets = externalApps.flatMap((app): StatusTarget[] => {
  const title = titleCase(app.name);
  const nodes =
    app.certDeploy?.type === "proxmox"
      ? app.certDeploy.nodes.map((node) =>
          tcpTarget(
            `${title} ${titleCase(node.name)}`,
            StatusGroup.Infrastructure,
            node.ipAddress,
            app.port,
          ),
        )
      : [];

  return [
    tcpTarget(title, StatusGroup.Infrastructure, app.ipAddress, app.port),
    ...nodes,
    ...routeTargets(title, app.name, { subDomain: app.subDomain }),
  ];
});

const nas = externalApps.find((app) => app.name === "truenas");

if (nas === undefined) {
  throw new Error(
    "externalApps no longer lists truenas, which hosts the NFS export",
  );
}

export const traefikStatusTargets: StatusTarget[] = [
  ...externalAppTargets,
  tcpTarget("NAS (NFS)", StatusGroup.Infrastructure, nas.ipAddress, NFS_PORT),
  httpTarget(
    "Argo CD",
    StatusGroup.Platform,
    serviceUrl("argocd-server", "argocd", 80, "/healthz"),
  ),
  ...routeTargets("Argo CD", "argocd", {}),
];
