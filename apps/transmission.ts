import type { WorkloadApp } from "../types";
import { applyModifiers, withNasMounts } from "../modifiers";

const openvpnSecretName = "openvpn-creds";

const base: WorkloadApp = {
  kind: "workload",
  name: "transmission",
  podSpec: {
    containers: [
      {
        name: "main",
        image: "haugene/transmission-openvpn:5.4.1",
        env: [
          { name: "OPENVPN_PROVIDER", value: "custom" },
          { name: "OPENVPN_CONFIG", value: "us-ma-37.protonvpn.udp" },
          {
            name: "OPENVPN_USERNAME",
            valueFrom: {
              secretKeyRef: {
                name: openvpnSecretName,
                key: "username",
              },
            },
          },
          {
            name: "OPENVPN_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: openvpnSecretName,
                key: "password",
              },
            },
          },
          { name: "LOCAL_NETWORK", value: "192.168.0.0/16" },
          { name: "HEALTH_CHECK_HOST", value: "1.1.1.1" },
          { name: "GLOBAL_APPLY_PERMISSIONS", value: "false" },
          { name: "PUID", value: "1000" },
          { name: "PGID", value: "1000" },
        ],
        ports: [{ name: "http", containerPort: 9091 }],
        securityContext: {
          capabilities: {
            add: ["NET_ADMIN"],
          },
        },
      },
    ],
    securityContext: {},
  },
  webPort: 9091,
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [
      { mountPath: "/data", subPath: "downloads" },
      { mountPath: "/config", subPath: "cluster/transmission/config" },
      {
        mountPath: "/etc/openvpn/custom",
        subPath: "cluster/transmission/protonvpn",
      },
    ],
  }),
);
