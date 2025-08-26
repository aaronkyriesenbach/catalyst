import { Chart } from "npm:cdk8s";
import { Construct } from "npm:constructs";
import { Lab53App } from "../../shared/helpers.ts";
import { HelmChart } from "../../shared/HelmChart.ts";
import { RedisEnterpriseCluster } from "../../shared/imports/rec-app.redislabs.com.ts";

class Redis extends Chart {
  constructor(scope: Construct) {
    super(scope, crypto.randomUUID());

    new HelmChart(this, {
      name: "redis-enterprise-operator",
      namespace: "redis",
      repo: "https://helm.redis.io",
      version: "7.22.0-17",
    });

    new RedisEnterpriseCluster(this, crypto.randomUUID(), {
      metadata: {
        name: "lab53-cluster",
      },
      spec: {
        nodes: 3,
        persistentSpec: {
          enabled: true,
        },
      },
    });
  }
}

const app = new Lab53App();
new Redis(app);
app.synth();
