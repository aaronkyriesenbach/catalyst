import { VolumeMount } from "../shared/imports/k8s.ts";
import { Construct } from "npm:constructs";
import { Chart } from "npm:cdk8s";
import ConfigMap from "../shared/ConfigMap.ts";
import GeneratedPassword from "../shared/GeneratedPassword.ts";
import { readTextFileSync } from "../shared/helpers.ts";
import Pod from "../shared/Pod.ts";

export class LLDAPBootstrap extends Chart {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const emptyConfigMap = new ConfigMap(
      this,
      {
        name: "empty-config",
        data: {
          "empty.json": "{}",
        },
      },
    );

    const emptyVolumeMounts = [
      "/bootstrap/group-configs",
      "/bootstrap/user-schemas",
      "/bootstrap/group-schemas",
    ].map((path): VolumeMount => ({
      name: emptyConfigMap.name,
      mountPath: path,
    }));

    const userConfigSecret = new GeneratedPassword(this, {
      name: "user-config",
      secretTemplate: {
        type: "Opaque",
        stringData: {
          password: "$(value)",
          "user.json": readTextFileSync("user.json"),
        },
      },
    });

    const ocisUserSecret = new GeneratedPassword(this, {
      name: "ocis-user-config",
      exportNamespaces: ["ocis"],
      secretTemplate: {
        type: "Opaque",
        stringData: {
          password: "$(value)",
          "ocis-user.json": readTextFileSync("ocis-user.json"),
          "reva-ldap-bind-password": "$(value)",
        },
      },
    });

    new Pod(this, {
      name: "lldap-bootstrap",
      podSpecProps: {
        restartPolicy: "OnFailure",
        containers: [{
          name: "lldap-bootstrap",
          image: "lldap/lldap:stable",
          command: ["/app/bootstrap.sh"],
          env: [
            {
              name: "LLDAP_URL",
              value: "http://lldap:17170",
            },
            {
              name: "LLDAP_ADMIN_PASSWORD",
              valueFrom: {
                secretKeyRef: {
                  name: "admin-pass",
                  key: "password",
                },
              },
            },
            {
              name: "DO_CLEANUP",
              value: "true",
            },
          ],
          volumeMounts: [{
            name: userConfigSecret.name,
            mountPath: "/bootstrap/user-configs/user.json",
            subPath: "user.json",
          }, {
            name: ocisUserSecret.name,
            mountPath: "/bootstrap/user-configs/ocis-user.json",
            subPath: "ocis-user.json",
          }, ...emptyVolumeMounts],
        }],
        volumes: [
          {
            name: userConfigSecret.name,
            secret: { secretName: userConfigSecret.name },
          },
          {
            name: ocisUserSecret.name,
            secret: { secretName: ocisUserSecret.name },
          },
          {
            name: emptyConfigMap.name,
            configMap: {
              name: emptyConfigMap.name,
            },
          },
        ],
      },
    });
  }
}
