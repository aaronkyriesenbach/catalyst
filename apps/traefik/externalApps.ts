import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { EndpointSlice } from "kubernetes-models/discovery.k8s.io/v1";
import { Service } from "kubernetes-models/v1";
import { Certificate } from "@kubernetes-models/cert-manager/cert-manager.io/v1";
import type { BackendTLSPolicy } from "../../types";
import {
  externalAppBackendCertSecretName,
  externalAppBackendHostname,
  externalApps,
} from "./externalApps.config";

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
        secretName: externalAppBackendCertSecretName(a),
        commonName: externalAppBackendHostname(a),
        dnsNames: [externalAppBackendHostname(a)],
        issuerRef: {
          name: "internal-ca",
          kind: "ClusterIssuer",
        },
      },
    }),
);

const externalBackendTlsPolicies: BackendTLSPolicy[] = externalApps.map(
  (a) => ({
    apiVersion: "gateway.networking.k8s.io/v1" as const,
    kind: "BackendTLSPolicy" as const,
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
        hostname: externalAppBackendHostname(a),
        caCertificateRefs: [
          {
            group: "",
            kind: "ConfigMap",
            name: "internal-root-ca-bundle",
          },
        ],
      },
    },
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
            name: "traefik-internal",
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
