import { LimitRange } from "kubernetes-models/v1";
import { Project } from "@catalyst/core/constants";
import { site } from "@catalyst/site";
import type { StaticApp } from "@catalyst/core/types";
import { appNamespace } from "@catalyst/core/apps";

const name = "limit-ranges";

const config: StaticApp = {
  kind: "static",
  status: { exempt: "Generates LimitRanges only; nothing runs" },
  name,
  namespace: "kube-system",
  project: Project.SYSTEM,
  derive: ({ catalog, cluster }) => {
    const namespaces = [
      ...new Set([
        ...cluster.gitops.unmanagedNamespaces,
        ...catalog.onCluster(cluster.name).map(appNamespace),
      ]),
    ].sort((a, b) => a.localeCompare(b));

    return {
      resources: namespaces.map(
        (namespace) =>
          new LimitRange({
            metadata: { name: "defaults", namespace },
            spec: {
              limits: [
                {
                  type: "Container",
                  defaultRequest: site.defaultContainerResources.requests,
                  default: site.defaultContainerResources.limits,
                },
              ],
            },
          }),
      ),
    };
  },
};

export default config;
