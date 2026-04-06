import { ClusterIssuer } from "@kubernetes-models/cert-manager/cert-manager.io/v1";

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

export const issuers = [stagingIssuer, prodIssuer];
