import type { HelmChart, StaticApp } from '../types';
import { internalCaResources } from './cert-manager/internal-ca';
import { issuers } from './cert-manager/issuers';

const chart: HelmChart = {
  apiVersion: 'helm.cattle.io/v1',
  kind: 'HelmChart',
  metadata: {
    name: 'cert-manager',
  },
  spec: {
    chart: 'oci://quay.io/jetstack/charts/cert-manager',
    targetNamespace: 'cert-manager',
    version: 'v1.20.1',
    set: {
      'crds.enabled': 'true',
    },
  },
};

const config: StaticApp = {
  kind: 'static',
  name: 'cert-manager',
  resources: [chart, ...issuers, ...internalCaResources],
};

export default config;
