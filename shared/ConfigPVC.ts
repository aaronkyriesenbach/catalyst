import { KubePersistentVolumeClaim, Quantity } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";

export default class ConfigPVC extends KubePersistentVolumeClaim {
    constructor(scope: Construct, id: string, props: ConfigPVCProps) {
        const { name, size, accessMode } = props;

        super(scope, id, {
            metadata: {
                name: name
            },
            spec: {
                resources: {
                    requests: {
                        storage: size ?? Quantity.fromString("100Mi")
                    }
                },
                accessModes: [accessMode ?? "ReadWriteOnce"]
            }
        });
    }
}

export type ConfigPVCProps = {
    name: string,
    size?: Quantity,
    accessMode?: string
}