import Application from "../shared/Application.ts";
import { Construct } from "npm:constructs";
import ConfigPVC from "../shared/ConfigPVC.ts";
import ConfigMap from "../shared/ConfigMap.ts";
import { readTextFileSync } from "../shared/helpers.ts";
import { LifecycleHandler } from "../shared/imports/k8s.ts";

export default class TransmissionApp extends Application {
  constructor(scope: Construct, props: TransmissionAppProps) {
    const { name, protonSecretName, downloadSubpath, postStartHook } = props;

    const scriptsCM = new ConfigMap(scope, {
      name: `${name}-scripts`,
      data: {
        "update-port.sh": readTextFileSync("update-port.sh"),
        "update-seedbox.sh": readTextFileSync("update-seedbox.sh"),
      },
    });

    const configPVC = new ConfigPVC(scope, {
      name: `${name}-config-pvc`,
    });

    const vpnPVC = new ConfigPVC(scope, {
      name: `${name}-openvpn-pvc`,
    });

    super(scope, {
      name: name,
      podSpecProps: {
        volumes: [{
          name: configPVC.name,
          persistentVolumeClaim: {
            claimName: configPVC.name,
          },
        }, {
          name: protonSecretName,
          secret: {
            secretName: protonSecretName,
          },
        }, {
          name: scriptsCM.name,
          configMap: {
            name: scriptsCM.name,
          },
        }, {
          name: vpnPVC.name,
          persistentVolumeClaim: {
            claimName: vpnPVC.name,
          },
        }],
        nasVolumeMounts: {
          "transmission-openvpn": [{
            mountPath: "/data",
            subPath: downloadSubpath,
          }],
        },
        containers: [{
          name: "transmission-openvpn",
          image: "haugene/transmission-openvpn:5.3.1",
          securityContext: {
            capabilities: {
              add: ["NET_ADMIN"],
            },
          },
          ports: [{ containerPort: 9091, name: "web" }],
          env: [{
            name: "OPENVPN_PROVIDER",
            value: "custom",
          }, {
            name: "OPENVPN_USERNAME",
            valueFrom: {
              secretKeyRef: {
                name: protonSecretName,
                key: "username",
              },
            },
          }, {
            name: "OPENVPN_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: protonSecretName,
                key: "password",
              },
            },
          }, {
            name: "OPENVPN_OPTS",
            value: "--inactive 3600 --ping 10 --ping-exit 60",
          }],
          volumeMounts: [{
            name: configPVC.name,
            mountPath: "/config",
          }, {
            name: vpnPVC.name,
            mountPath: "/etc/openvpn/custom",
          }],
          lifecycle: postStartHook
            ? {
              postStart: postStartHook,
            }
            : undefined,
        }],
        initContainers: [{
          name: "copy-openvpn-config",
          image: "busybox:stable",
          command: [
            "/bin/sh",
            "-c",
            "cp /openvpn/ma.ovpn /pvc/default.ovpn && cp /portforwarding/*.sh /pvc/ && chmod +x /pvc/*.sh",
          ],
          volumeMounts: [{
            name: protonSecretName,
            mountPath: "/openvpn",
          }, {
            name: scriptsCM.name,
            mountPath: "/portforwarding",
          }, {
            name: vpnPVC.name,
            mountPath: "/pvc",
          }],
        }],
      },
      webPort: 9091,
    });
  }
}

export type TransmissionAppProps = {
  name: string;
  protonSecretName: string;
  downloadSubpath: string;
  postStartHook?: LifecycleHandler;
};
