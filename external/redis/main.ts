import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";
import { RedisEnterpriseCluster } from "../../shared/imports/rec-app.redislabs.com.ts";
import { KubeClusterRole, KubeConfigMap, KubeRoleBinding } from "../../shared/imports/k8s.ts";
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

    const managedNamespaces = ["auth", "immich", "outline"];

    // Roles and bindings created per https://redis.io/docs/latest/operate/kubernetes/7.4.6/re-clusters/multi-namespace/
    new KubeClusterRole(this, crypto.randomUUID(), {
      metadata: {
        name: `redb-role`,
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
    });

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
            kind: "ClusterRole",
            name: "redb-role",
            apiGroup: "rbac.authorization.k8s.io",
          },
        }),
    );

    new KubeConfigMap(this, crypto.randomUUID(), {
      metadata: {
        name: "operator-environment-config",
      },
      data: {
        REDB_NAMESPACES: managedNamespaces.join(","),
      },
    });
  }
}

const app = new Lab53App();
new Redis(app);
app.synth();
