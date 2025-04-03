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
    }],
    nasVolumeMounts: {
      "transmission-openvpn": [{
        mountPath: "/data",
        subPath: "downloads",
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
      }],
      volumeMounts: [{
        name: "config",
        mountPath: "/config",
      }, {
        name: "vpn-creds",
        mountPath: "/etc/openvpn/custom",
      }],
    }],
  };
}
