import {
  GatewayClass,
  Gateway,
  HTTPRoute,
} from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { AppConfig } from "../types";
import { Certificate } from "@kubernetes-models/cert-manager/cert-manager.io/v1";

const gatewayClass = new GatewayClass({
  metadata: {
    name: "traefik",
  },
  spec: {
    controllerName: "traefik.io/gateway-controller",
  },
});

const internalCertStaging = new Certificate({
  metadata: {
    name: "int-lab53-net-staging",
  },
  spec: {
    secretName: "int-lab53-net-staging",
    dnsNames: ["int.lab53.net", "*.int.lab53.net"],
    issuerRef: {
      name: "letsencrypt-staging",
      kind: "ClusterIssuer",
    },
  },
});

const externalCertStaging = new Certificate({
  metadata: {
    name: "lab53-net-staging",
  },
  spec: {
    secretName: "lab53-net-staging",
    dnsNames: ["lab53.net", "*.lab53.net"],
    issuerRef: {
      name: "letsencrypt-staging",
      kind: "ClusterIssuer",
    },
  },
});

const gateway = new Gateway({
  metadata: {
    name: "traefik",
  },
  spec: {
    gatewayClassName: "traefik",
    listeners: [
      {
        name: "http-int",
        protocol: "HTTP",
        port: 80,
        hostname: "*.int.lab53.net",
      },
      {
        name: "http",
        protocol: "HTTP",
        port: 80,
        hostname: "*.lab53.net",
      },
      {
        name: "https-int",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.int.lab53.net",
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "int-lab53-net-staging",
            },
          ],
        },
      },
      {
        name: "https",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.lab53.net",
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "lab53-net-staging",
            },
          ],
        },
      },
    ],
  },
});

const internalRedirect = new HTTPRoute({
  metadata: {
    name: "http-redirect-int",
  },
  spec: {
    parentRefs: [
      {
        name: "traefik",
        sectionName: "http-int",
      },
    ],
    hostnames: ["*.int.lab53.net"],
    rules: [
      {
        filters: [
          {
            type: "RequestRedirect",
            requestRedirect: {
              scheme: "https",
              statusCode: 301,
            },
          },
        ],
      },
    ],
  },
});

const externalRedirect = new HTTPRoute({
  metadata: {
    name: "http-redirect",
  },
  spec: {
    parentRefs: [
      {
        name: "traefik",
        sectionName: "http",
      },
    ],
    hostnames: ["*.lab53.net"],
    rules: [
      {
        filters: [
          {
            type: "RequestRedirect",
            requestRedirect: {
              scheme: "https",
              statusCode: 301,
            },
          },
        ],
      },
    ],
  },
});

const config: AppConfig = {
  name: "traefik",
  extraResources: [
    gatewayClass,
    internalCertStaging,
    externalCertStaging,
    gateway,
    internalRedirect,
    externalRedirect,
  ],
};

export default config;
