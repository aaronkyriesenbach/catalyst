import { Cluster, ClusterSpecManagedRolesEnsure, ClusterSpecPostgresql } from "./imports/postgresql.cnpg.io.ts";
import { Construct } from "npm:constructs";

export default class CNPGCluster extends Cluster {
  constructor(scope: Construct, props: ClusterProps) {
    const {
      appName,
      customClusterName,
      dbName,
      username = appName,
      secretName,
      superuser,
      imageName,
      postgresql,
      instances,
      storageSize,
      postInitSQL,
    } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: customClusterName ?? `${appName}-cluster`,
      },
      spec: {
        imageName: imageName,
        postgresql: postgresql,
        bootstrap: {
          initdb: {
            database: dbName ?? appName,
            owner: username,
            secret: secretName ? { name: secretName } : undefined,
            postInitSql: postInitSQL,
          },
        },
        managed: {
          roles: [{
            name: username,
            connectionLimit: -1,
            ensure: ClusterSpecManagedRolesEnsure.PRESENT,
            inherit: true,
            login: true,
            superuser: superuser,
          }],
        },
        instances: instances ?? 3,
        storage: {
          size: storageSize ?? "10Gi",
        },
      },
    });
  }
}

export type ClusterProps = {
  appName: string;
  customClusterName?: string;
  dbName?: string;
  username?: string;
  secretName?: string;
  superuser?: boolean;
  imageName?: string;
  postgresql?: ClusterSpecPostgresql;
  instances?: number;
  storageSize?: string;
  postInitSQL?: string[];
};
