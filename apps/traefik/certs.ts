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

export const certs = [
  internalCertStaging,
  externalCertStaging,
  internalCert,
  externalCert,
];
