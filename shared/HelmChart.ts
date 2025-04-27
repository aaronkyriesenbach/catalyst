import { HelmChart as HelmChartConstruct } from "./imports/helm.cattle.io.ts"
import { Construct } from "npm:constructs";

export class HelmChart extends HelmChartConstruct {
    constructor(scope: Construct, props: HelmChartProps) {
        const { name, repo, chartName, namespace, values } = props;

        super(scope, crypto.randomUUID(), {
            metadata: {
                name: name,
                namespace: namespace ?? name
            },
            spec: {
                repo: repo,
                chart: chartName ?? name,
                targetNamespace: namespace ?? name,
                valuesContent: values
            }
        })
    }
}

export type HelmChartProps = {
    name: string,
    repo: string,
    chartName?: string
    namespace?: string
    values?: string
}