import * as k8s from "@pulumi/kubernetes";
import { helmRelease } from "@catalyst/infra/helm";
import { lockedDownNamespace } from "@catalyst/infra/namespace";
import { config, opts } from "./context";
import {
  apiServerEgress,
  ciliumPolicy,
  dnsEgress,
  internetEgress,
} from "../policies";

const namespace = lockedDownNamespace(
  "cert-manager",
  { podSecurity: "restricted" },
  opts,
);

ciliumPolicy(
  "cert-manager",
  namespace.name,
  {
    ingress: [
      {
        fromEntities: ["kube-apiserver", "host", "remote-node"],
        toPorts: [{ ports: [{ port: "10250", protocol: "TCP" }] }],
      },
    ],
    egress: [dnsEgress, apiServerEgress, internetEgress([443, 53])],
  },
  { ...opts, parent: namespace.namespace },
);

export const certManager = helmRelease(
  "cert-manager",
  {
    chart: "certManager",
    namespace: namespace.name,
    values: {
      crds: { enabled: true },
      global: { leaderElection: { namespace: "cert-manager" } },
      enableCertificateOwnerRef: true,
      extraArgs: [
        "--dns01-recursive-nameservers-only",
        "--dns01-recursive-nameservers=1.1.1.1:53,8.8.8.8:53",
      ],
    },
  },
  { ...opts, dependsOn: [namespace.namespace] },
);

const cloudflareToken = new k8s.core.v1.Secret(
  "cloudflare-api-token",
  {
    metadata: { name: "cloudflare-api-token", namespace: namespace.name },
    stringData: { "api-token": config.requireSecret("cloudflareApiToken") },
  },
  opts,
);

export const clusterIssuerName = "letsencrypt";

export const clusterIssuer = new k8s.apiextensions.CustomResource(
  "letsencrypt",
  {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: { name: clusterIssuerName },
    spec: {
      acme: {
        email: config.require("acmeEmail"),
        server: "https://acme-v02.api.letsencrypt.org/directory",
        privateKeySecretRef: { name: "cluster-issuer-account-key" },
        solvers: [
          {
            dns01: {
              cloudflare: {
                apiTokenSecretRef: {
                  name: cloudflareToken.metadata.name,
                  key: "api-token",
                },
              },
            },
          },
        ],
      },
    },
  },
  { ...opts, dependsOn: [certManager] },
);
