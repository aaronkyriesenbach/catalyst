import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";
import { RedisEnterpriseCluster } from "../../shared/imports/rec-app.redislabs.com.ts";
import {
  KubeClusterRole,
  KubeClusterRoleBinding,
  KubeNamespace,
  KubeRole,
  KubeRoleBinding,
} from "../../shared/imports/k8s.ts";
import { stringify } from "npm:yaml@2.7.1";

class Redis extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "redis-enterprise-operator",
      namespace: "redis",
      repo: "https://helm.redis.io",
      version: "7.22.0-17",
      values: stringify({
        operator: {
          image: {
            repository: "hub.int.lab53.net/redislabs/operator",
          },
        },
      }),
    });

    const recNamespace = "redis";

    const cluster = new RedisEnterpriseCluster(this, crypto.randomUUID(), {
      metadata: {
        name: "lab53-cluster",
        namespace: recNamespace,
      },
      spec: {
        nodes: 3,
        persistentSpec: {
          enabled: true,
        },
        redisEnterpriseImageSpec: {
          repository: "hub.int.lab53.net/redislabs/redis",
        },
        bootstrapperImageSpec: {
          repository: "hub.int.lab53.net/redislabs/operator",
        },
        redisEnterpriseServicesRiggerImageSpec: {
          repository: "hub.int.lab53.net/redislabs/k8s-controller",
        },
      },
    });

    const managedNamespaces = ["authelia", "immich", "outline"];

    managedNamespaces.map(
      (namespace) =>
        new KubeNamespace(this, crypto.randomUUID(), {
          metadata: {
            name: namespace,
            labels: {
              "redis.enabled": "true",
            },
          },
        }),
    );

    // Roles and bindings created per https://redis.io/docs/latest/operate/kubernetes/7.4.6/re-clusters/multi-namespace/
    managedNamespaces.map(
      (namespace) =>
        new KubeRole(this, crypto.randomUUID(), {
          metadata: {
            name: `redb-role-${namespace}`,
            namespace: namespace,
            labels: {
              app: "redis-enterprise",
            },
          },
          rules: [
            {
              apiGroups: ["app.redislabs.com"],
              resources: [
                "redisenterpriseclusters",
                "redisenterpriseclusters/status",
                "redisenterpriseclusters/finalizers",
                "redisenterprisedatabases",
                "redisenterprisedatabases/status",
                "redisenterprisedatabases/finalizers",
                "redisenterpriseremoteclusters",
                "redisenterpriseremoteclusters/status",
                "redisenterpriseremoteclusters/finalizers",
                "redisenterpriseactiveactivedatabases",
                "redisenterpriseactiveactivedatabases/status",
                "redisenterpriseactiveactivedatabases/finalizers",
              ],
              verbs: [
                "delete",
                "deletecollection",
                "get",
                "list",
                "patch",
                "create",
                "update",
                "watch",
              ],
            },
            {
              apiGroups: [""],
              resources: ["secrets"],
              verbs: [
                "update",
                "get",
                "read",
                "list",
                "listallnamespaces",
                "watch",
                "watchlist",
                "watchlistallnamespaces",
                "create",
                "patch",
                "replace",
                "delete",
                "deletecollection",
              ],
            },
            {
              apiGroups: [""],
              resources: ["endpoints"],
              verbs: ["get", "list", "watch"],
            },
            {
              apiGroups: [""],
              resources: ["events"],
              verbs: ["create"],
            },
            {
              apiGroups: [""],
              resources: ["services"],
              verbs: [
                "get",
                "watch",
                "list",
                "update",
                "patch",
                "create",
                "delete",
              ],
            },
          ],
        }),
    );

    managedNamespaces.map(
      (namespace) =>
        new KubeRoleBinding(this, crypto.randomUUID(), {
          metadata: {
            name: `redb-role-${namespace}`,
            namespace: namespace,
            labels: {
              app: "redis-enterprise",
            },
          },
          subjects: [
            {
              kind: "ServiceAccount",
              name: "redis-enterprise-operator",
              namespace: recNamespace,
            },
            {
              kind: "ServiceAccount",
              name: cluster.name,
              namespace: recNamespace,
            },
          ],
          roleRef: {
            kind: "Role",
            name: `redb-role-${namespace}`,
            apiGroup: "rbac.authorization.k8s.io",
          },
        }),
    );

    new KubeClusterRole(this, crypto.randomUUID(), {
      metadata: {
        name: "redis-enterprise-operator-consumer-ns",
        labels: {
          app: "redis-enterprise",
        },
      },
      rules: [
        {
          apiGroups: [""],
          resources: ["namespaces"],
          verbs: ["list", "watch"],
        },
      ],
    });

    new KubeClusterRoleBinding(this, crypto.randomUUID(), {
      metadata: {
        name: "redis-enterprise-operator-consumer-ns",
        labels: {
          app: "redis-enterprise",
        },
      },
      subjects: [
        {
          kind: "ServiceAccount",
          name: "redis-enterprise-operator",
          namespace: recNamespace,
        },
      ],
      roleRef: {
        kind: "ClusterRole",
        name: "redis-enterprise-operator-consumer-ns",
        apiGroup: "rbac.authorization.k8s.io",
      },
    });
  }
}

const app = new Lab53App();
new Redis(app);
app.synth();
