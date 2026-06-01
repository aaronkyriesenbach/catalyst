import type { WorkloadApp } from "../types";
import { applyModifiers, withNasMounts, withOidcAuth } from "../modifiers";

const vpnSecretName = "reader-vpn-creds";
const mamSecretName = "reader-mam";

// ArgoCD CMP substitutes $VAR with empty string in rendered manifests.
// Use $$ to emit a literal $ in the final YAML.
const D = "$$";

const mamUpdaterScript = [
  `while true`,
  `do echo "[${D}(date)] Updating MAM dynamic seedbox IP..."`,
  `response=${D}(curl -s -w "\\nHTTP_STATUS:%{http_code}" -b "mam_id=${D}{MAM_ID}" "https://t.myanonamouse.net/json/dynamicSeedbox.php")`,
  `body=${D}(echo "${D}response" | sed "/HTTP_STATUS:/d")`,
  `status=${D}(echo "${D}response" | grep "HTTP_STATUS:" | cut -d: -f2)`,
  `echo "${D}body"`,
  `if [ "${D}status" != "200" ]; then echo "[${D}(date)] ERROR: MAM update failed with HTTP ${D}status"`,
  `elif echo "${D}body" | grep -qi "error"; then echo "[${D}(date)] ERROR: MAM returned error response"`,
  `else echo "[${D}(date)] MAM update successful"; fi`,
  `sleep 1800; done`,
].join("; ");

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
            name: "UPDATER_QBITTORRENT_ADDRESSES",
            value: "http://localhost:8080",
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
    dnsPolicy: "None",
    dnsConfig: {
      nameservers: ["127.0.0.1"],
    },
  },
  webPort: 8080,
  subDomain: "reader",
};

export default applyModifiers(
  base,
  withNasMounts({
    qbittorrent: [
      { mountPath: "/downloads", subPath: "downloads/reader" },
      { mountPath: "/config", subPath: "cluster/reader/config" },
    ],
  }),
  withOidcAuth({ middleware: { enabled: true } }),
);
