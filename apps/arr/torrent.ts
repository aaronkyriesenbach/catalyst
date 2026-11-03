import { buildBackupResources } from "../../backup";
import { execCheck, readiness, startup, tcpCheck } from "../../probes";
import type { ResourceLike } from "../../types";
import {
  awsRemoteKey,
  buildAwsExternalSecret,
  buildDeployment,
  buildFileConfigMap,
  buildIscsiPvc,
  buildService,
  image,
  readFile,
} from "../../utils";
import {
  arrNamespace,
  mediaClaim,
  mediaMount,
  mediaPaths,
  mediaVolume,
  nonRootId,
  podCidr,
  restrictedContainer,
  timezone,
} from "./common";

export const torrentName = "torrent";
export const torrentPort = 8080;
export const torrentHost = `${torrentName}.${arrNamespace}.svc`;

const vpnSecretName = `${torrentName}-vpn`;
const pvcName = `${torrentName}-config`;
const initScriptName = `${torrentName}-init`;

const initScript = buildFileConfigMap(initScriptName, {
  "qbittorrent-init.sh": await readFile(
    "./qbittorrent-init.sh",
    import.meta.url,
  ),
});

// Gluetun's health server binds to loopback, so only an exec probe can reach it.
const gluetunHealth = execCheck(
  "wget",
  "-q",
  "-O",
  "/dev/null",
  "http://127.0.0.1:9999",
);

const qbittorrentApi = `http://127.0.0.1:${torrentPort}/api/v2/app/setPreferences`;
const portForwardCommand = `/bin/sh -c "wget -O- -nv --retry-connrefused --post-data 'json={\\"listen_port\\":{{PORT}},\\"random_port\\":false,\\"upnp\\":false}' ${qbittorrentApi}"`;

// gluetun is the one container in the stack that cannot run non-root: it needs root and NET_ADMIN
// to build the tunnel and kill-switch. It shares a pod with qBittorrent so all torrent traffic
// leaves through the VPN.
const deployment = buildDeployment(
  torrentName,
  {
    securityContext: {
      fsGroup: nonRootId,
      fsGroupChangePolicy: "OnRootMismatch",
      seccompProfile: { type: "RuntimeDefault" },
    },
    initContainers: [
      {
        name: "config",
        image: image("curl"),
        command: ["/bin/sh", "/scripts/qbittorrent-init.sh"],
        env: [
          { name: "SAVE_PATH", value: mediaPaths.torrents },
          { name: "INCOMPLETE_PATH", value: mediaPaths.torrentsIncomplete },
          { name: "TRUSTED_SUBNET", value: podCidr },
        ],
        securityContext: restrictedContainer({
          readOnlyRootFilesystem: true,
        }),
        volumeMounts: [
          { name: "config", mountPath: "/config" },
          { name: "scripts", mountPath: "/scripts", readOnly: true },
        ],
      },
    ],
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
          { name: "SERVER_COUNTRIES", value: "United States" },
          { name: "PORT_FORWARD_ONLY", value: "on" },
          { name: "VPN_PORT_FORWARDING", value: "on" },
          { name: "VPN_PORT_FORWARDING_PROVIDER", value: "protonvpn" },
          {
            name: "VPN_PORT_FORWARDING_UP_COMMAND",
            value: portForwardCommand,
          },
          { name: "FIREWALL_INPUT_PORTS", value: String(torrentPort) },
          { name: "TZ", value: timezone },
        ],
        readinessProbe: readiness(gluetunHealth),
        startupProbe: startup(gluetunHealth, 180),
        securityContext: {
          runAsUser: 0,
          runAsNonRoot: false,
          capabilities: { add: ["NET_ADMIN"] },
        },
      },
      {
        name: "qbittorrent",
        image: image("qbittorrentNox"),
        env: [
          { name: "QBT_LEGAL_NOTICE", value: "confirm" },
          { name: "QBT_WEBUI_PORT", value: String(torrentPort) },
          { name: "QBT_TORRENTING_PORT", value: "6881" },
          { name: "TZ", value: timezone },
        ],
        ports: [{ name: "http", containerPort: torrentPort }],
        readinessProbe: readiness(tcpCheck(torrentPort)),
        startupProbe: startup(tcpCheck(torrentPort), 120),
        securityContext: restrictedContainer(),
        volumeMounts: [{ name: "config", mountPath: "/config" }, mediaMount],
      },
    ],
    volumes: [
      { name: "config", persistentVolumeClaim: { claimName: pvcName } },
      { name: "scripts", configMap: { name: initScriptName } },
      mediaVolume(mediaClaim),
    ],
    // Gluetun runs the resolver; cluster DNS is unreachable behind its firewall.
    dnsPolicy: "None",
    dnsConfig: { nameservers: ["127.0.0.1"] },
  },
  { strategy: { type: "Recreate" }, progressDeadlineSeconds: 600 },
);

export const torrentResources: ResourceLike[] = [
  buildAwsExternalSecret(vpnSecretName, [
    {
      remoteKey: awsRemoteKey(arrNamespace, "vpn-credentials"),
      property: "wireguard-private-key",
      secretKey: "wireguard-private-key",
    },
  ]),
  initScript,
  buildIscsiPvc(pvcName, "2Gi"),
  ...buildBackupResources(arrNamespace, pvcName),
  deployment,
  buildService(torrentName, [{ port: torrentPort, name: "http" }]),
];
