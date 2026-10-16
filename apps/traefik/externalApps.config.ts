import type { ExternalApp } from "../../types";

export const externalApps: ExternalApp[] = [
  {
    name: "unifi",
    ipAddress: "192.168.1.1",
    port: 443,
    subDomain: "ui",
    insecure: true,
    certDeploy: { type: "unifi-local-api" },
  },
  {
    name: "truenas",
    ipAddress: "192.168.53.120",
    port: 443,
    insecure: true,
    certDeploy: { type: "truenas" },
  },
  {
    name: "proxmox",
    ipAddress: "192.168.53.100",
    port: 8006,
    subDomain: "pve",
    certDeploy: {
      type: "proxmox",
      nodes: [
        { name: "andromeda", ipAddress: "192.168.53.101" },
        { name: "sirius", ipAddress: "192.168.53.102" },
      ],
    },
  },
];

export function externalAppBackendCertSecretName(app: ExternalApp) {
  return `${app.name}-backend-cert`;
}

export function externalAppBackendHostname(app: ExternalApp) {
  return `${app.name}.backend.lab53.net`;
}

export function externalAppDownloadBaseName(app: ExternalApp) {
  return `${app.name}-backend`;
}

export function externalAppDeployCredsSecretName(app: ExternalApp) {
  return `${app.name}-deploy-creds`;
}
