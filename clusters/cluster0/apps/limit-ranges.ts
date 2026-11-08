import { LimitRange } from "kubernetes-models/v1";
import {
  defaultContainerResources,
  Project,
  unmanagedNamespaces,
} from "@catalyst/core/constants";
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
        ...unmanagedNamespaces,
        ...catalog.onCluster(cluster).map(appNamespace),
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
                  defaultRequest: defaultContainerResources.requests,
                  default: defaultContainerResources.limits,
                },
              ],
            },
          }),
      ),
    };
  },
};

export default config;
