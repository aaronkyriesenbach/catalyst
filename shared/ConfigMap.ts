import { Construct } from "npm:constructs";
import { KubeConfigMap } from "./imports/k8s.ts";

export default class ConfigMap extends KubeConfigMap {
    constructor(scope: Construct, id: string, props: ConfigMapProps) {
        const { name, data } = props;

        super(scope, id, {
            metadata: {
                name: name
            },
            data: data
        });
    }
}

export type ConfigMapProps = {
    name: string,
    data: Object
}