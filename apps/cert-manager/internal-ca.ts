import {
  Certificate,
  ClusterIssuer,
} from "@kubernetes-models/cert-manager/cert-manager.io/v1";

const internalCaBootstrapIssuer = new ClusterIssuer({
  metadata: {
    name: "internal-ca-bootstrap",
  },
  spec: {
    selfSigned: {},
  },
});

const internalRootCa = new Certificate({
  metadata: {
    name: "internal-root-ca",
  },
  spec: {
    isCA: true,
    commonName: "lab53 internal root ca",
    secretName: "internal-root-ca",
    issuerRef: {
      name: "internal-ca-bootstrap",
      kind: "ClusterIssuer",
    },
  },
});

const internalCa = new ClusterIssuer({
  metadata: {
    name: "internal-ca",
  },
  spec: {
    ca: {
      secretName: "internal-root-ca",
    },
  },
});

export const internalCaResources = [
  internalCaBootstrapIssuer,
  internalRootCa,
  internalCa,
];
