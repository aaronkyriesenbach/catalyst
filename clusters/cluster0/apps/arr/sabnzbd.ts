import { readiness, startup, tcpCheck } from "@catalyst/k8s/probes";
import type { ResourceLike } from "@catalyst/core/types";
import {
  awsRemoteKey,
  buildAwsExternalSecret,
  buildGeneratedSecret,
} from "@catalyst/k8s/secrets";
import {
  buildDeployment,
  buildFileConfigMap,
  buildService,
} from "@catalyst/k8s/workload";
import { buildIscsiPvc } from "@catalyst/k8s/storage";
import { image } from "@catalyst/versions/images";
import { readFile } from "@catalyst/core/files";
import { appHostname } from "@catalyst/platform/hostnames";
import {
  arrNamespace,
  mediaClaim,
  mediaMount,
  mediaPaths,
  mediaVolume,
  podCidr,
  podSecurityContext,
  restrictedContainer,
  timezone,
  tmpMount,
  tmpVolume,
} from "./common";

export const sabnzbdName = "sabnzbd";
export const sabnzbdPort = 8080;
export const sabnzbdCategories = ["radarr", "sonarr", "lidarr"] as const;

const pvcName = `${sabnzbdName}-config`;
const initScriptName = `${sabnzbdName}-init`;
const apiKeySecret = `${sabnzbdName}-api-key`;
const nzbKeySecret = `${sabnzbdName}-nzb-key`;
const usenetSecret = "usenet-credentials";

export const sabnzbdApiKeySecret = { name: apiKeySecret, key: "api-key" };

const initScript = buildFileConfigMap(initScriptName, {
  "sabnzbd-init.sh": await readFile("./sabnzbd-init.sh", import.meta.url),
});

// SABnzbd rejects any Host header it does not know, including the in-cluster Service name.
const hostWhitelist = [
  appHostname(sabnzbdName),
  sabnzbdName,
  `${sabnzbdName}.${arrNamespace}`,
  `${sabnzbdName}.${arrNamespace}.svc`,
  `${sabnzbdName}.${arrNamespace}.svc.cluster.local`,
].join(", ");

// Optional so SABnzbd still starts before a provider is configured in AWS.
const usenetEnv = (name: string, property: string) => ({
  name,
  valueFrom: {
    secretKeyRef: { name: usenetSecret, key: property, optional: true },
  },
});

const secretEnv = (name: string, secret: string, key: string) => ({
  name,
  valueFrom: { secretKeyRef: { name: secret, key } },
});

export const sabnzbdResources: ResourceLike[] = [
  ...buildGeneratedSecret(
    arrNamespace,
    apiKeySecret,
    [{ key: "api-key", length: 32, alphanumeric: true }],
    { persist: true },
  ),
  ...buildGeneratedSecret(
    arrNamespace,
    nzbKeySecret,
    [{ key: "nzb-key", length: 32, alphanumeric: true }],
    { persist: true },
  ),
  buildAwsExternalSecret(
    usenetSecret,
    ["host", "username", "password"].map((property) => ({
      remoteKey: awsRemoteKey(arrNamespace, usenetSecret),
      property,
      secretKey: property,
    })),
  ),
  initScript,
  buildIscsiPvc(pvcName, "2Gi"),
  buildDeployment(
    sabnzbdName,
    {
      securityContext: podSecurityContext,
      initContainers: [
        {
          name: "config",
          image: image("sabnzbd"),
          command: ["/usr/bin/env", "bash", "/scripts/sabnzbd-init.sh"],
          env: [
            { name: "INCOMPLETE_DIR", value: mediaPaths.usenetIncomplete },
            { name: "COMPLETE_DIR", value: mediaPaths.usenetComplete },
            { name: "CATEGORIES", value: sabnzbdCategories.join(" ") },
            { name: "USENET_PORT", value: "563" },
            { name: "USENET_CONNECTIONS", value: "30" },
            usenetEnv("USENET_HOST", "host"),
            usenetEnv("USENET_USERNAME", "username"),
            usenetEnv("USENET_PASSWORD", "password"),
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
          name: "main",
          image: image("sabnzbd"),
          env: [
            { name: "TZ", value: timezone },
            { name: "HOME", value: "/config" },
            secretEnv("SABNZBD__API_KEY", apiKeySecret, "api-key"),
            secretEnv("SABNZBD__NZB_KEY", nzbKeySecret, "nzb-key"),
            { name: "SABNZBD__HOST_WHITELIST_ENTRIES", value: hostWhitelist },
            { name: "SABNZBD__LOCAL_RANGES_ENTRIES", value: podCidr },
          ],
          ports: [{ name: "http", containerPort: sabnzbdPort }],
          // Unpacking and par2 repair use several cores in bursts.
          resources: {
            requests: { cpu: "500m", memory: "512Mi" },
            limits: { cpu: "2", memory: "2Gi" },
          },
          // `/` can answer 403 to the kubelet's Host header, so only the port is probed.
          readinessProbe: readiness(tcpCheck(sabnzbdPort)),
          startupProbe: startup(tcpCheck(sabnzbdPort), 120),
          securityContext: restrictedContainer({
            readOnlyRootFilesystem: true,
          }),
          volumeMounts: [
            { name: "config", mountPath: "/config" },
            tmpMount,
            mediaMount,
          ],
        },
      ],
      volumes: [
        { name: "config", persistentVolumeClaim: { claimName: pvcName } },
        { name: "scripts", configMap: { name: initScriptName } },
        tmpVolume,
        mediaVolume(mediaClaim),
      ],
    },
    { strategy: { type: "Recreate" } },
  ),
  buildService(sabnzbdName, [{ port: sabnzbdPort, name: "http" }]),
];
