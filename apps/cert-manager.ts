import { ClusterIssuer } from "@kubernetes-models/cert-manager/cert-manager.io/v1";
import { AppConfig } from "../types";

const chart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "cert-manager",
  },
  spec: {
    chart: "oci://quay.io/jetstack/charts/cert-manager",
    targetNamespace: "cert-manager",
    version: "v1.20.1",
    set: {
      "crds.enabled": "true",
    },
  },
};

const stagingIssuer = new ClusterIssuer({
  metadata: {
    name: "letsencrypt-staging",
  },
  spec: {
    acme: {
      server: "https://acme-staging-v02.api.letsencrypt.org/directory",
      privateKeySecretRef: {
        name: "letsencrypt-staging-key",
      },
      solvers: [
        {
          dns01: {
            route53: {
              region: "us-east-1",
              accessKeyIDSecretRef: {
                name: "route53-creds",
                key: "access-key-id",
              },
              secretAccessKeySecretRef: {
                name: "route53-creds",
                key: "secret-access-key",
              },
            },
          },
        },
      ],
    },
  },
});

const prodIssuer = new ClusterIssuer({
  metadata: {
    name: "letsencrypt-prod",
  },
  spec: {
    acme: {
      server: "https://acme-v02.api.letsencrypt.org/directory",
      privateKeySecretRef: {
        name: "letsencrypt-prod-key",
      },
      solvers: [
        {
          dns01: {
            route53: {
              region: "us-east-1",
              accessKeyIDSecretRef: {
                name: "route53-creds",
                key: "access-key-id",
              },
              secretAccessKeySecretRef: {
                name: "route53-creds",
                key: "secret-access-key",
              },
            },
          },
        },
      ],
    },
  },
});

const config: AppConfig = {
  name: "cert-manager",
  extraResources: [chart, stagingIssuer, prodIssuer],
};

export default config;
