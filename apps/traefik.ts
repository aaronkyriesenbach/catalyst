import {
  Gateway,
  HTTPRoute,
} from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { AppConfig } from "../types";
import { Certificate } from "@kubernetes-models/cert-manager/cert-manager.io/v1";

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

const internalCert = new Certificate({
  metadata: {
    name: "int-lab53-net-prod",
  },
  spec: {
    secretName: "int-lab53-net-prod",
    dnsNames: ["int.lab53.net", "*.int.lab53.net"],
    issuerRef: {
      name: "letsencrypt-prod",
      kind: "ClusterIssuer",
    },
  },
});

const externalCert = new Certificate({
  metadata: {
    name: "lab53-net-prod",
  },
  spec: {
    secretName: "lab53-net-prod",
    dnsNames: ["lab53.net", "*.lab53.net"],
    issuerRef: {
      name: "letsencrypt-prod",
      kind: "ClusterIssuer",
    },
  },
});

const gateway = new Gateway({
  metadata: {
    name: "traefik",
    annotations: {
      "external-dns.alpha.kubernetes.io/target": "192.168.53.210",
    },
  },
  spec: {
    gatewayClassName: "traefik",
    listeners: [
      {
        name: "http",
        protocol: "HTTP",
        port: 80,
      },
      {
        name: "https-int",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.int.lab53.net",
        allowedRoutes: {
          namespaces: {
            from: "All",
          },
        },
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "int-lab53-net-prod",
            },
          ],
        },
      },
      {
        name: "https",
        protocol: "HTTPS",
        port: 443,
        hostname: "*.lab53.net",
        allowedRoutes: {
          namespaces: {
            from: "All",
          },
        },
        tls: {
          certificateRefs: [
            {
              kind: "Secret",
              name: "lab53-net-prod",
            },
          ],
        },
      },
    ],
  },
});

const httpRedirect = new HTTPRoute({
  metadata: {
    name: "http-redirect",
    annotations: {
      "external-dns.alpha.kubernetes.io/gateway-hostname-source":
        "defined-hosts-only",
    },
  },
  spec: {
    parentRefs: [
      {
        name: "traefik",
        sectionName: "http",
      },
    ],
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

const config: AppConfig = {
  name: "traefik",
  extraResources: [
    internalCertStaging,
    externalCertStaging,
    internalCert,
    externalCert,
    gateway,
    httpRedirect,
    argoRoute,
  ],
};

export default config;
