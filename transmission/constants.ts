import { PodSpecProps } from "../shared/Pod.ts";

export function getTransmissionPodSpec(
  configPVCName: string,
  protonSecretName: string,
): PodSpecProps {
  return {
    volumes: [{
      name: "config",
      persistentVolumeClaim: {
        claimName: configPVCName,
      },
    }, {
      name: "vpn-creds",
      secret: {
        secretName: protonSecretName,
      },
    }, {
      name: "port-forward-script",
      configMap: {
        name: "port-forward-script",
      },
    }],
    nasVolumeMounts: {
      "transmission-openvpn": [{
        mountPath: "/data",
        subPath: "downloads",
      }],
    },
    securityContext: {
      fsGroup: 1000,
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
        name: "PGID",
        value: "1000",
      }],
      volumeMounts: [{
        name: "config",
        mountPath: "/config",
      }, {
        name: "vpn-creds",
        mountPath: "/creds",
      }, {
        name: "port-forward-script",
        mountPath: "/portforward",
      }],
      lifecycle: {
        postStart: {
          exec: {
            command: [
              "/bin/sh",
              "-c",
              "cp /creds/default.ovpn /etc/openvpn/custom/default.ovpn && cp /portforward/update-port.sh /etc/openvpn/custom/update-port.sh",
            ],
          },
        },
      },
    }],
  };
}
