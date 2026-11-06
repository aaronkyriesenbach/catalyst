import { LimitRange } from "kubernetes-models/v1";
import {
  defaultContainerResources,
  Project,
  unmanagedNamespaces,
} from "../constants";
import type { StaticApp } from "../types";
import { appNamespace, loadAllAppConfigs } from "../utils";

const name = "limit-ranges";

// LimitRange is namespaced and there is no cluster-wide equivalent, so one is
// generated for every namespace an app deploys into. Shared namespaces would
// otherwise have several apps own the same object. A namespace created in the
// same sync fails the first attempt and succeeds on Argo's retry; pods that start
// in between keep no defaults until they restart.
const appConfigs = await loadAllAppConfigs(["limit-ranges.ts"]);
const namespaces = [
  ...new Set([...unmanagedNamespaces, ...appConfigs.map(appNamespace)]),
].sort((a, b) => a.localeCompare(b));

const config: StaticApp = {
  kind: "static",
  name,
  namespace: "kube-system",
  project: Project.SYSTEM,
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

export default config;
