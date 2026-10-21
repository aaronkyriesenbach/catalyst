import { execCheck, readiness, startup, tcpCheck } from "../probes";
import type { WorkloadApp } from "../types";
import {
  applyModifiers,
  withIscsiVolumes,
  withForwardAuth,
  withNasMounts,
} from "../modifiers";
import { buildFileConfigMap, readFile, image } from "../utils";

const vpnSecretName = "reader-vpn-creds";
const mamSecretName = "reader-mam";

const qbtInitConfigMap = buildFileConfigMap("reader-qbt-init", {
  "setup-qbittorrent.sh": await readFile(
    "./reader/setup-qbittorrent.sh",
    import.meta.url,
  ),
});

const mamUpdaterConfigMap = buildFileConfigMap("reader-mam-updater", {
  "mam-updater.sh": await readFile("./reader/mam-updater.sh", import.meta.url),
});

const gluetunHealthCheck = execCheck(
  "wget",
  "-q",
  "-O",
  "/dev/null",
  "http://127.0.0.1:9999",
);

const base: WorkloadApp = {
  kind: "workload",
  name: "reader",
  podSpec: {
    containers: [
      {
        name: "gluetun",
        image: image("gluetun"),
        env: [
          { name: "VPN_SERVICE_PROVIDER", value: "protonvpn" },
          { name: "VPN_TYPE", value: "wireguard" },
          {
            name: "WIREGUARD_PRIVATE_KEY",
            valueFrom: {
              secretKeyRef: {
                name: vpnSecretName,
                key: "wireguard-private-key",
              },
            },
          },
          {
            name: "SERVER_HOSTNAMES",
            value: "node-us-317.protonvpn.net",
          },
          { name: "VPN_PORT_FORWARDING", value: "true" },
          {
            name: "VPN_PORT_FORWARDING_PROVIDER",
            value: "protonvpn",
          },
          {
            name: "VPN_PORT_FORWARDING_UP_COMMAND",
            value: `/bin/sh -c "wget -O- -nv --retry-connrefused --post-data 'json={\\"listen_port\\":{{PORT}},\\"random_port\\":false,\\"upnp\\":false}' http://127.0.0.1:8080/api/v2/app/setPreferences"`,
          },
          { name: "FIREWALL_INPUT_PORTS", value: "8080" },
        ],
        ports: [{ name: "http", containerPort: 8080 }],
        // Gluetun's health server binds to loopback, so only an exec probe can reach it.
        readinessProbe: readiness(gluetunHealthCheck),
        startupProbe: startup(gluetunHealthCheck, 180),
        securityContext: {
          capabilities: {
            add: ["NET_ADMIN"],
          },
        },
      },
      {
        name: "qbittorrent",
        image: image("qbittorrent"),
        env: [
          { name: "PUID", value: "1000" },
          { name: "PGID", value: "1000" },
          { name: "WEBUI_PORT", value: "8080" },
        ],
        readinessProbe: readiness(tcpCheck(8080)),
        volumeMounts: [
          {
            name: "qbt-init",
            mountPath: "/custom-cont-init.d",
            readOnly: true,
          },
        ],
      },
      {
        name: "mam-updater",
        image: image("curl"),
        command: ["/bin/sh", "/scripts/mam-updater.sh"],
        env: [
          {
            name: "MAM_ID",
            valueFrom: {
              secretKeyRef: {
                name: mamSecretName,
                key: "mam_id",
              },
            },
          },
        ],
        volumeMounts: [
          {
            name: "mam-updater-script",
            mountPath: "/scripts",
            readOnly: true,
          },
        ],
      },
    ],
    securityContext: {},
    volumes: [
      {
        name: "qbt-init",
        configMap: { name: "reader-qbt-init", defaultMode: 0o755 },
      },
      {
        name: "mam-updater-script",
        configMap: { name: "reader-mam-updater" },
      },
    ],
    dnsPolicy: "None",
    dnsConfig: {
      nameservers: ["127.0.0.1"],
    },
  },
  webPort: 8080,
  subDomain: "reader",
  extraResources: [qbtInitConfigMap, mamUpdaterConfigMap],
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    qbittorrent: [
      {
        name: "config",
        mountPath: "/config",
        storageRequest: "2Gi",
        backup: true,
      },
    ],
  }),
  withNasMounts({
    qbittorrent: [{ mountPath: "/downloads", subPath: "downloads/reader" }],
  }),
  withForwardAuth(),
);
