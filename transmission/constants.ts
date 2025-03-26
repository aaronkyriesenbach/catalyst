import { PodSpecProps } from "../shared/Pod.ts";
import { DEFAULT_LSCR_ENV } from "../shared/constants.ts";

export function getTransmissionPodSpec(
  configPVCName: string,
  gluetunConfigName: string,
): PodSpecProps {
  return {
    containers: [{
      name: "transmission",
      image: "lscr.io/linuxserver/transmission:4.0.6-r2-ls281",
      env: DEFAULT_LSCR_ENV,
      ports: [{ containerPort: 9091, name: "web" }],
      volumeMounts: [
        {
          name: configPVCName,
          mountPath: "/config",
        },
      ],
    }],
    initContainers: [{
      name: "gluetun",
      image: "qmcgaw/gluetun:v3.40.0",
      restartPolicy: "Always",
      securityContext: {
        capabilities: {
          add: ["NET_ADMIN"],
        },
      },
      ports: [{ name: "web", containerPort: 9091 }],
      env: [
        {
          name: "VPN_SERVICE_PROVIDER",
          value: "protonvpn",
        },
        {
          name: "VPN_TYPE",
          value: "wireguard",
        },
        {
          name: "SERVER_COUNTRIES",
          value: "United States",
        },
        {
          name: "PORT_FORWARD_ONLY",
          value: "on",
        },
        {
          name: "VPN_PORT_FORWARDING",
          value: "on",
        },
        {
          name: "WIREGUARD_PRIVATE_KEY",
          valueFrom: {
            secretKeyRef: {
              name: "wireguard-private-key",
              key: "key",
            },
          },
        },
      ],
      volumeMounts: [
        {
          name: gluetunConfigName,
          mountPath: "/gluetun/auth",
        },
        {
          name: configPVCName,
          mountPath: "/gluetun",
        },
      ],
    }, {
      name: "gluetrans",
      image: "miklosbagi/gluetrans:v0.3.5",
      restartPolicy: "Always",
      env: [
        {
          name: "GLUETUN_CONTROL_ENDPOINT",
          value: "http://localhost:8000",
        },
        {
          name: "GLUETUN_CONTROL_API_KEY",
          valueFrom: {
            secretKeyRef: {
              name: gluetunConfigName,
              key: "key",
            },
          },
        },
        {
          name: "GLUETUN_HEALTH_ENDPOINT",
          value: "http://localhost:9999",
        },
        {
          name: "TRANSMISSION_ENDPOINT",
          value: "http://localhost:9091/transmission/rpc",
        },
        {
          name: "TRANSMISSION_USER",
          value: "transmission",
        },
        {
          name: "TRANSMISSION_PASS",
          value: "transmission",
        },
      ],
    }],
    volumes: [{
      name: configPVCName,
      persistentVolumeClaim: {
        claimName: configPVCName,
      },
    }, {
      name: gluetunConfigName,
      secret: {
        secretName: gluetunConfigName,
      },
    }],
  };
}
