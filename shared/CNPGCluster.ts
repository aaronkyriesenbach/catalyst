import { Cluster, ClusterSpecPostgresql } from "./imports/postgresql.cnpg.io.ts";
import { Construct } from "npm:constructs";
import { SecretKeySelector } from "./imports/k8s.ts";

export default class CNPGCluster extends Cluster {
    constructor(scope: Construct, id: string, props: ClusterProps) {
        const {
            appName,
            customClusterName,
            dbName,
            username,
            passwordSecret,
            superuser,
            imageName,
            postgresql,
            instances,
            storageSize
        } = props;

        const clusterUsername = username ?? appName;

        super(scope, id, {
            metadata: {
                name: customClusterName ?? `${ appName }-cluster`
            },
            spec: {
                imageName: imageName,
                postgresql: postgresql,
                bootstrap: {
                    initdb: {
                        database: dbName ?? appName,
                        owner: clusterUsername,
                        secret: passwordSecret
                    }
                },
                managed: {
                    roles: [{
                        name: clusterUsername,
                        connectionLimit: -1,
                        ensure: "present",
                        inherit: true,
                        login: true,
                        superuser: superuser
                    }]
                },
                instances: instances ?? 3,
                storage: {
                    size: storageSize ?? "10Gi"
                }
            }
        });
    }
}

export type ClusterProps = {
    appName: string,
    customClusterName?: string,
    dbName?: string,
    username?: string,
    passwordSecret?: SecretKeySelector,
    superuser?: boolean,
    imageName?: string,
    postgresql?: ClusterSpecPostgresql,
    instances?: number,
    storageSize?: string
}