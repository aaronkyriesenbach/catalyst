import type { StaticApp } from '../types';
import { certs } from './traefik/certs';
import { httpRedirect } from './traefik/redirect';
import { externalGateway, internalGateway } from './traefik/gateway';
import { routes } from './traefik/routes';
import { externalAppResources } from './traefik/externalApps';

const config: StaticApp = {
  kind: 'static',
  name: 'traefik',
  resources: [
    ...certs,
    internalGateway,
    externalGateway,
    httpRedirect,
    ...routes,
    ...externalAppResources,
  ],
};

export default config;
