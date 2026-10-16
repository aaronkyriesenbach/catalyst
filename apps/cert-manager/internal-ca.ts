import {
  Certificate,
  ClusterIssuer,
} from "@kubernetes-models/cert-manager/cert-manager.io/v1";

export const internalRootCaSecretName = "internal-root-ca";

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
    secretName: internalRootCaSecretName,
    // cert-manager v1.18+ defaults privateKey.rotationPolicy to "Always", so a
    // root CA with no explicit key policy rotates its key on every renewal and
    // breaks the chain for certs installed outside the cluster (the
    // *.backend.lab53.net certs on TrueNAS/Proxmox). Pin the key and keep the
    // CA long-lived.
    duration: "87600h",
    renewBefore: "2160h",
    privateKey: {
      rotationPolicy: "Never",
    },
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
