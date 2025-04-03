import { PodSpecProps } from "../shared/Pod.ts";

export function getTransmissionPodSpec(
  configPVCName: string,
  protonSecretName: string,
  openvpnPVCName: string,
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
    }, {
      name: openvpnPVCName,
      persistentVolumeClaim: {
        claimName: openvpnPVCName,
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
      }],
      volumeMounts: [{
        name: "config",
        mountPath: "/config",
      }, {
        name: openvpnPVCName,
        mountPath: "/etc/openvpn/custom",
      }],
    }],
    initContainers: [{
      name: "copy-openvpn-config",
      image: "busybox:stable",
      command: [
        "/bin/sh",
        "-c",
        "cp /openvpn/default.ovpn /pvc/default.ovpn && cp /portforwarding/update-port.sh /pvc/update-port.sh && chmod +x /pvc/update-port.sh",
      ],
      volumeMounts: [{
        name: "vpn-creds",
        mountPath: "/openvpn",
      }, {
        name: "port-forward-script",
        mountPath: "/portforwarding",
      }, {
        name: openvpnPVCName,
        mountPath: "/pvc",
      }],
    }],
  };
}
