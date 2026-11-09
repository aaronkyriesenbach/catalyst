import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { helmCharts, type HelmChartKey } from "@catalyst/versions/versions";

export type HelmReleaseArgs = {
  readonly chart: HelmChartKey;
  readonly namespace: pulumi.Input<string>;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly skipAwait?: boolean;
};

export function helmRelease(
  name: string,
  args: HelmReleaseArgs,
  opts?: pulumi.CustomResourceOptions,
): k8s.helm.v3.Release {
  const entry = helmCharts[args.chart];

  return new k8s.helm.v3.Release(
    name,
    {
      name,
      namespace: args.namespace,
      chart: entry.chart,
      version: entry.version,
      ...(entry.kind === "repo"
        ? { repositoryOpts: { repo: entry.repo } }
        : {}),
      values: { ...args.values },
      skipAwait: args.skipAwait,
    },
    opts,
  );
}
