import { readFileSync } from "node:fs";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import * as tls from "@pulumi/tls";
import { helmRelease } from "@catalyst/infra/helm";
import { lockedDownNamespace } from "@catalyst/infra/namespace";
import { image } from "@catalyst/versions/images";
import { hostnames, wireguardIp, wireguardPort } from "../common";
import { backupBucket, backupCredentials } from "./aws";
import { config, opts } from "./context";
import { adminEmail, omniClientId, omniClientSecret } from "./dex";
import { gateway, gatewayName, gatewayNamespace } from "./gateway";
import {
  ciliumPolicy,
  dnsEgress,
  fromGateway,
  internetEgress,
} from "../policies";

const etcdPort = 2379;
const omniPodLabels = {
  "app.kubernetes.io/name": "omni",
  "app.kubernetes.io/instance": "omni",
};

function etcdCertificates(namespace: pulumi.Input<string>) {
  const algorithm = { algorithm: "ECDSA", ecdsaCurve: "P256" };
  const tenYears = 87600;

  const caKey = new tls.PrivateKey("omni-etcd-ca", algorithm);
  const ca = new tls.SelfSignedCert("omni-etcd-ca", {
    privateKeyPem: caKey.privateKeyPem,
    subject: { commonName: "omni-etcd-ca" },
    isCaCertificate: true,
    validityPeriodHours: tenYears,
    allowedUses: ["cert_signing", "crl_signing"],
  });

  const issue = (
    name: string,
    use: "server_auth" | "client_auth",
    names: { dnsNames?: string[]; ipAddresses?: string[] },
  ) => {
    const key = new tls.PrivateKey(name, algorithm);
    const request = new tls.CertRequest(name, {
      privateKeyPem: key.privateKeyPem,
      subject: { commonName: name },
      ...names,
    });
    const certificate = new tls.LocallySignedCert(name, {
      certRequestPem: request.certRequestPem,
      caPrivateKeyPem: caKey.privateKeyPem,
      caCertPem: ca.certPem,
      validityPeriodHours: tenYears,
      allowedUses: [use],
    });

    return new k8s.core.v1.Secret(
      name,
      {
        metadata: { name, namespace },
        stringData: {
          "tls.crt": certificate.certPem,
          "tls.key": key.privateKeyPem,
          "ca.crt": ca.certPem,
        },
      },
      opts,
    );
  };

  return {
    server: issue("omni-etcd-server", "server_auth", {
      dnsNames: [
        "localhost",
        "omni-etcd",
        "omni-etcd.omni.svc",
        "omni-etcd.omni.svc.cluster.local",
      ],
      ipAddresses: ["127.0.0.1"],
    }),
    client: issue("omni-etcd-client", "client_auth", {}),
  };
}

export function deployOmni(): void {
  const storageClass = config.get("storageClass");

  if (config.getBoolean("omniEnabled") !== true) {
    return;
  }

  if (storageClass === undefined) {
    throw new Error("omniEnabled requires the storageClass config value");
  }

  const namespace = lockedDownNamespace(
    "omni",
    { podSecurity: "privileged" },
    opts,
  );
  const certificates = etcdCertificates(namespace.name);

  const gpgKey = new k8s.core.v1.Secret(
    "omni-gpg-key",
    {
      metadata: { name: "omni-gpg-key", namespace: namespace.name },
      stringData: { "omni.asc": config.requireSecret("etcdEncryptionKey") },
    },
    opts,
  );

  const oidcSecret = new k8s.core.v1.Secret(
    "omni-oidc-secret",
    {
      metadata: { name: "omni-oidc-secret", namespace: namespace.name },
      stringData: {
        "config.yaml": pulumi.interpolate`auth:\n  oidc:\n    clientSecret: ${omniClientSecret.result}\n`,
      },
    },
    opts,
  );

  const accountId = new random.RandomUuid("omni-account-id");
  const advertised = (host: string) => `https://${host}`;
  const route = (section: keyof typeof hostnames) => ({
    enabled: true,
    hostnames: [hostnames[section]],
    parentRefs: [
      { name: gatewayName, namespace: gatewayNamespace, sectionName: section },
    ],
  });

  const omni = helmRelease(
    "omni",
    {
      chart: "omni",
      namespace: namespace.name,
      values: {
        config: {
          account: { id: accountId.result, name: "lab53" },
          eulaAccept: { name: "Aaron Ky-Riesenbach", email: adminEmail },
          auth: {
            auth0: { enabled: false },
            oidc: {
              enabled: true,
              clientID: omniClientId,
              providerURL: advertised(hostnames.dex),
              scopes: ["openid", "profile", "email"],
            },
            initialUsers: [adminEmail],
            initialServiceAccount: {
              name: "automation",
              role: "Admin",
              keyPath: "/initial-key/key",
            },
          },
          services: {
            api: { advertisedURL: advertised(hostnames.omni) },
            kubernetesProxy: {
              advertisedURL: advertised(hostnames.kubernetes),
            },
            machineAPI: { advertisedURL: advertised(hostnames.siderolink) },
            siderolink: {
              wireGuard: {
                advertisedEndpoint: `${wireguardIp}:${wireguardPort}`,
              },
            },
          },
          storage: {
            default: {
              etcd: {
                endpoints: [`https://0.0.0.0:${etcdPort}`],
                embeddedCertFile: "/etcd-tls/tls.crt",
                embeddedKeyFile: "/etcd-tls/tls.key",
                embeddedCaFile: "/etcd-tls/ca.crt",
              },
            },
          },
        },
        additionalConfigSources: [
          { existingSecret: oidcSecret.metadata.name, key: "config.yaml" },
        ],
        etcdEncryptionKey: { existingSecret: gpgKey.metadata.name },
        persistence: { storageClassName: storageClass, size: "16Gi" },
        resources: {
          requests: { cpu: "250m", memory: "512Mi" },
          limits: { cpu: "2", memory: "2Gi" },
        },
        gatewayApi: {
          ui: route("omni"),
          kubernetesProxy: route("kubernetes"),
          siderolinkApi: route("siderolink"),
        },
        service: {
          wireguard: {
            type: "LoadBalancer",
            port: wireguardPort,
            annotations: { "lbipam.cilium.io/ips": wireguardIp },
          },
        },
        extraVolumes: [
          {
            name: "etcd-tls",
            secret: { secretName: certificates.server.metadata.name },
          },
          { name: "initial-key", emptyDir: {} },
        ],
        extraContainers: [
          {
            name: "key-reader",
            image: image("awsCli"),
            command: ["/bin/sh", "-c", "sleep infinity"],
            resources: {
              requests: { cpu: "1m", memory: "8Mi" },
              limits: { cpu: "50m", memory: "32Mi" },
            },
            securityContext: {
              allowPrivilegeEscalation: false,
              capabilities: { drop: ["ALL"] },
              readOnlyRootFilesystem: true,
            },
            volumeMounts: [
              {
                name: "initial-key",
                mountPath: "/initial-key",
                readOnly: true,
              },
            ],
          },
        ],
        extraVolumeMounts: [
          { name: "etcd-tls", mountPath: "/etcd-tls", readOnly: true },
          { name: "initial-key", mountPath: "/initial-key" },
        ],
      },
    },
    { ...opts, dependsOn: [namespace.namespace, gateway] },
  );

  new k8s.core.v1.Service(
    "omni-etcd",
    {
      metadata: { name: "omni-etcd", namespace: namespace.name },
      spec: {
        selector: omniPodLabels,
        ports: [{ name: "etcd", port: etcdPort }],
      },
    },
    { ...opts, dependsOn: [omni] },
  );

  const scripts = new k8s.core.v1.ConfigMap(
    "omni-backup-scripts",
    {
      metadata: { name: "omni-backup-scripts", namespace: namespace.name },
      data: {
        "upload.sh": readFileSync(
          new URL("./backup/upload.sh", import.meta.url),
          "utf8",
        ),
      },
    },
    opts,
  );

  const awsCredentials = new k8s.core.v1.Secret(
    "omni-backup-aws",
    {
      metadata: { name: "omni-backup-aws", namespace: namespace.name },
      stringData: {
        AWS_ACCESS_KEY_ID: backupCredentials.accessKeyId,
        AWS_SECRET_ACCESS_KEY: backupCredentials.secretAccessKey,
        AWS_DEFAULT_REGION: aws.getRegionOutput().region,
        BUCKET: backupBucket.bucket,
      },
    },
    opts,
  );

  const backupLabels = { "app.kubernetes.io/name": "omni-etcd-backup" };
  const hardened = {
    allowPrivilegeEscalation: false,
    capabilities: { drop: ["ALL"] },
  };

  new k8s.batch.v1.CronJob(
    "omni-etcd-backup",
    {
      metadata: { name: "omni-etcd-backup", namespace: namespace.name },
      spec: {
        schedule: "0 */6 * * *",
        concurrencyPolicy: "Forbid",
        successfulJobsHistoryLimit: 1,
        failedJobsHistoryLimit: 3,
        jobTemplate: {
          spec: {
            backoffLimit: 2,
            template: {
              metadata: { labels: backupLabels },
              spec: {
                restartPolicy: "OnFailure",
                initContainers: [
                  {
                    name: "snapshot",
                    image: image("etcd"),
                    command: ["etcdctl"],
                    args: [
                      `--endpoints=https://omni-etcd:${etcdPort}`,
                      "--cacert=/etcd-client/ca.crt",
                      "--cert=/etcd-client/tls.crt",
                      "--key=/etcd-client/tls.key",
                      "snapshot",
                      "save",
                      "/snapshots/snapshot.db",
                    ],
                    securityContext: hardened,
                    volumeMounts: [
                      { name: "etcd-client", mountPath: "/etcd-client" },
                      { name: "snapshots", mountPath: "/snapshots" },
                    ],
                  },
                ],
                containers: [
                  {
                    name: "upload",
                    image: image("awsCli"),
                    command: ["/bin/sh", "/scripts/upload.sh"],
                    envFrom: [
                      { secretRef: { name: awsCredentials.metadata.name } },
                    ],
                    securityContext: hardened,
                    volumeMounts: [
                      { name: "snapshots", mountPath: "/snapshots" },
                      { name: "scripts", mountPath: "/scripts" },
                    ],
                  },
                ],
                volumes: [
                  {
                    name: "etcd-client",
                    secret: { secretName: certificates.client.metadata.name },
                  },
                  { name: "snapshots", emptyDir: {} },
                  {
                    name: "scripts",
                    configMap: { name: scripts.metadata.name },
                  },
                ],
              },
            },
          },
        },
      },
    },
    opts,
  );

  const parent = { ...opts, parent: namespace.namespace };
  const etcdPorts = [{ ports: [{ port: String(etcdPort), protocol: "TCP" }] }];

  ciliumPolicy(
    "omni",
    namespace.name,
    {
      endpointSelector: { matchLabels: omniPodLabels },
      ingress: [
        fromGateway([8080, 8090, 8095]),
        {
          fromEntities: ["world"],
          toPorts: [
            { ports: [{ port: String(wireguardPort), protocol: "UDP" }] },
          ],
        },
        {
          fromEndpoints: [{ matchLabels: backupLabels }],
          toPorts: etcdPorts,
        },
      ],
      egress: [dnsEgress, { toEntities: ["world", "ingress"] }],
    },
    parent,
  );

  ciliumPolicy(
    "omni-etcd-backup",
    namespace.name,
    {
      endpointSelector: { matchLabels: backupLabels },
      egress: [
        dnsEgress,
        internetEgress([443]),
        {
          toEndpoints: [{ matchLabels: omniPodLabels }],
          toPorts: etcdPorts,
        },
      ],
    },
    parent,
  );
}
