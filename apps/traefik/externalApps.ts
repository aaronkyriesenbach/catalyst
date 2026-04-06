import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { EndpointSlice } from "kubernetes-models/discovery.k8s.io/v1";
import { Service } from "kubernetes-models/v1";
import { ExternalApp } from "../../types";
import { Certificate } from "@kubernetes-models/cert-manager/cert-manager.io/v1";

const externalApps: ExternalApp[] = [
  {
    name: "unifi",
    ipAddress: "192.168.1.1",
    port: 443,
    subDomain: "ui",
    insecure: true,
  },
  {
    name: "truenas",
    ipAddress: "192.168.53.120",
    port: 443,
    insecure: true,
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
        labels: {
          "kubernetes.io/service-name": `${a.name}-external`,
        },
      },
      addressType: "IPv4",
      ports: [
        {
          name: "https",
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

const externalCerts = externalApps.map(
  (a) =>
    new Certificate({
      metadata: {
        name: `${a.name}-backend-cert`,
      },
      spec: {
        secretName: `${a.name}-backend-cert`,
        commonName: `${a.name}.backend.lab53.net`,
        dnsNames: [`${a.name}.backend.lab53.net`],
        issuerRef: {
          name: "internal-ca",
          kind: "ClusterIssuer",
        },
      },
    }),
);

const externalBackendTlsPolicies = externalApps.map((a) => ({
  apiVersion: "gateway.networking.k8s.io/v1",
  kind: "BackendTLSPolicy",
  metadata: {
    name: `${a.name}-external-tls`,
  },
  spec: {
    targetRefs: [
      {
        name: `${a.name}-external`,
        group: "",
        kind: "Service",
        sectionName: "https",
      },
    ],
    validation: {
      hostname: `${a.name}.backend.lab53.net`,
      caCertificateRefs: [
        {
          group: "",
          kind: "ConfigMap",
          name: "internal-root-ca-bundle", // This ConfigMap needs to be created by hand: key ca.crt = the contents of cert-manager/internal-root-ca's tls.crt key
        },
      ],
    },
  },
}));

const externalServices = externalApps.map(
  (a) =>
    new Service({
      metadata: {
        name: `${a.name}-external`,
      },
      spec: {
        ports: [
          {
            name: "https",
            port: a.port,
            targetPort: a.port,
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

export const externalAppResources = [
  ...externalEndpointSlices,
  ...externalCerts,
  ...externalBackendTlsPolicies,
  ...externalServices,
  ...externalRoutes,
];
