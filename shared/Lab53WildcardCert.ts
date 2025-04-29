import { CertificateSpecIssuerRef } from "./imports/cert-manager.io.ts";
import { Certificate } from "./imports/certificate-cert-manager.io.ts";
import { Construct } from "npm:constructs";
import { TlsStore } from "./imports/tlsstore-traefik.io.ts"

export class Lab53WildcardCert extends Certificate {
  constructor(scope: Construct, props: Lab53WildcardCertProps) {
    const { subdomain, issuerRef } = props;
    const baseDomain = subdomain ? `${subdomain}.lab53.net` : "lab53.net";
    const secretName = "lab53-wildcard-cert-secret"

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: "lab53-wildcard-cert",
      },
      spec: {
        secretName: secretName,
        dnsNames: [baseDomain, `*.${baseDomain}`],
        issuerRef: issuerRef
      },
    });

    new TlsStore(this, crypto.randomUUID(), {
      metadata: {
        name: "default",
      },
      spec: {
        defaultCertificate: {
          secretName: secretName
        }
      }
    })
  }
}

export type Lab53WildcardCertProps = {
  issuerRef: CertificateSpecIssuerRef;
  subdomain?: string;
};
