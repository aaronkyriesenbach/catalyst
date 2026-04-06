import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { ExternalApp } from "../../types";
import { Service } from "kubernetes-models/v1";
import { EndpointSlice } from "kubernetes-models/discovery.k8s.io/v1";
import { Model } from "@kubernetes-models/base";

const argoRoute = new HTTPRoute({
  metadata: {
    name: "argocd",
    namespace: "argocd",
  },
  spec: {
    parentRefs: [
      {
        name: "traefik",
        namespace: "traefik",
      },
    ],
    hostnames: ["argocd.int.lab53.net"],
    rules: [
      {
        backendRefs: [
          {
            name: "argocd-server",
            namespace: "argocd",
            port: 80,
          },
        ],
      },
    ],
  },
});

const externalApps: ExternalApp[] = [
  {
    name: "unifi",
    ipAddress: "192.168.1.1",
    port: 443,
    subDomain: "ui",
  },
  {
    name: "truenas",
    ipAddress: "192.168.53.120",
    port: 443,
  },
  {
    name: "proxmox",
    ipAddress: "192.168.53.100",
    port: 8006,
    subDomain: "pve",
  },
];

const externalEndpointSlices = externalApps.map(
  (a) =>
    new EndpointSlice({
      metadata: {
        name: `${a.name}-external`,
      },
      addressType: "IPv4",
      ports: [
        {
          port: a.port,
        },
      ],
      endpoints: [
        {
          addresses: [a.ipAddress],
          conditions: {
            ready: true,
          },
        },
      ],
    }),
);

const externalServices = externalApps.map(
  (a) =>
    new Service({
      metadata: {
        name: `${a.name}-external`,
      },
      spec: {
        ports: [
          {
            port: a.port,
          },
        ],
      },
    }),
);

const externalRoutes = externalApps.map(
  (a) =>
    new HTTPRoute({
      metadata: {
        name: `${a.name}-external`,
      },
      spec: {
        parentRefs: [
          {
            name: "traefik",
          },
        ],
        hostnames: [`${a.subDomain ?? a.name}.int.lab53.net`],
        rules: [
          {
            backendRefs: [
              {
                name: `${a.name}-external`,
                port: a.port,
              },
            ],
          },
        ],
      },
    }),
);

export const routes = [
  argoRoute,
  ...externalEndpointSlices,
  ...externalServices,
  ...externalRoutes,
];
