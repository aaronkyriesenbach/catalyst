import type { WorkloadApp } from "../types";
import { applyModifiers, withIscsiVolumes, withNasMounts, withOidcAuth } from "../modifiers";
import { buildFileConfigMap, escapeArgoCmp, readFile } from "../utils";

const vpnSecretName = "reader-vpn-creds";
const mamSecretName = "reader-mam";

const mamUpdaterScript = escapeArgoCmp(
  [
    "while true",
    'do echo "[$(date)] Updating MAM dynamic seedbox IP..."',
    'response=$(curl -s -w "\\nHTTP_STATUS:%{http_code}" -b "mam_id=${MAM_ID}" "https://t.myanonamouse.net/json/dynamicSeedbox.php")',
    'body=$(echo "$response" | sed "/HTTP_STATUS:/d")',
    'status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)',
    'echo "$body"',
    'if [ "$status" != "200" ]; then echo "[$(date)] ERROR: MAM update failed with HTTP $status"',
    'elif echo "$body" | grep -qi "error"; then echo "[$(date)] ERROR: MAM returned error response"',
    'else echo "[$(date)] MAM update successful"; fi',
    "sleep 1800; done",
  ].join("; "),
);

const qbtInitConfigMap = buildFileConfigMap("reader-qbt-init", {
  "setup-qbittorrent.sh": await readFile(
    "./reader/setup-qbittorrent.sh",
    import.meta.url,
  ),
});

const base: WorkloadApp = {
  kind: "workload",
  name: "reader",
  podSpec: {
    containers: [
      {
        name: "gluetun",
        image: "docker.int.lab53.net/qmcgaw/gluetun:v3.41.1",
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
          { name: "SERVER_HOSTNAMES", value: "node-us-317.protonvpn.net" },
          { name: "VPN_PORT_FORWARDING", value: "true" },
          { name: "VPN_PORT_FORWARDING_PROVIDER", value: "protonvpn" },
          {
            name: "VPN_PORT_FORWARDING_UP_COMMAND",
            value: `/bin/sh -c "wget -O- -nv --retry-connrefused --post-data 'json={\\"listen_port\\":{{PORT}},\\"random_port\\":false,\\"upnp\\":false}' http://127.0.0.1:8080/api/v2/app/setPreferences"`,
          },
          { name: "FIREWALL_INPUT_PORTS", value: "8080" },
        ],
        ports: [{ name: "http", containerPort: 8080 }],
        securityContext: {
          capabilities: {
            add: ["NET_ADMIN"],
          },
        },
      },
      {
        name: "qbittorrent",
        image: "docker.int.lab53.net/linuxserver/qbittorrent:5.2.1",
        env: [
          { name: "PUID", value: "1000" },
          { name: "PGID", value: "1000" },
          { name: "WEBUI_PORT", value: "8080" },
        ],
        volumeMounts: [
          { name: "qbt-init", mountPath: "/custom-cont-init.d", readOnly: true },
        ],
      },
      {
        name: "mam-updater",
        image: "docker.int.lab53.net/curlimages/curl:8.12.1",
        command: ["/bin/sh", "-c"],
        args: [mamUpdaterScript],
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
      },
    ],
    securityContext: {},
    volumes: [
      { name: "qbt-init", configMap: { name: "reader-qbt-init", defaultMode: 0o755 } },
    ],
    dnsPolicy: "None",
    dnsConfig: {
      nameservers: ["127.0.0.1"],
    },
  },
  webPort: 8080,
  subDomain: "reader",
  extraResources: [qbtInitConfigMap],
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    qbittorrent: [{ name: "config", mountPath: "/config", storageRequest: "2Gi", backup: true }],
  }),
  withNasMounts({
    qbittorrent: [{ mountPath: "/downloads", subPath: "downloads/reader" }],
  }),
  withOidcAuth({ middleware: { enabled: true } }),
);
