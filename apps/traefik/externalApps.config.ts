import type { ExternalApp } from '../../types';

export const certManagerNamespace = 'cert-manager';
export const internalRootCaSecretName = 'internal-root-ca';
export const traefikNamespace = 'traefik';
export const internalRootCaBundleConfigMapName = 'internal-root-ca-bundle';

export const externalApps: ExternalApp[] = [
  {
    name: 'unifi',
    ipAddress: '192.168.1.1',
    port: 443,
    subDomain: 'ui',
    insecure: true,
  },
  {
    name: 'truenas',
    ipAddress: '192.168.53.120',
    port: 443,
    insecure: true,
  },
  {
    name: 'proxmox',
    ipAddress: '192.168.53.100',
    port: 8006,
    subDomain: 'pve',
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
