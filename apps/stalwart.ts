import { Certificate } from "@kubernetes-models/cert-manager/cert-manager.io/v1";
import {
  applyModifiers,
  nasVolumeMounts,
  withNasMounts,
} from "../modifiers";
import type { BackendTLSPolicy, WorkloadApp } from "../types";
import { buildGeneratedSecret, readFile } from "../utils";

const name = "stalwart";
const adminSecretName = `${name}-admin-credentials`;
const userSecretName = `${name}-user-credentials`;
const tlsSecretName = `${name}-tls`;

const bootstrapPayload = JSON.stringify(
  JSON.parse(
    await readFile("./stalwart/bootstrap-payload.json", import.meta.url),
  ),
);

const createUserPayload = JSON.stringify(
  JSON.parse(
    await readFile("./stalwart/create-user-payload.json", import.meta.url),
  ),
);

const bootstrapScript = await readFile(
  "./stalwart/bootstrap.sh",
  import.meta.url,
);

const tlsCertificate = new Certificate({
  metadata: { name: `${name}-tls` },
  spec: {
    secretName: tlsSecretName,
    commonName: "stalwart.lab53.net",
    dnsNames: ["stalwart.lab53.net"],
    issuerRef: {
      name: "internal-ca",
      kind: "ClusterIssuer",
    },
  },
});

const backendTlsPolicy: BackendTLSPolicy = {
  apiVersion: "gateway.networking.k8s.io/v1",
  kind: "BackendTLSPolicy",
  metadata: { name: `${name}-backend-tls` },
  spec: {
    targetRefs: [
      {
        name,
        group: "",
        kind: "Service",
        sectionName: "https",
      },
    ],
    validation: {
      hostname: "stalwart.lab53.net",
      caCertificateRefs: [
        {
          group: "",
          kind: "ConfigMap",
          name: "internal-root-ca-bundle",
        },
      ],
    },
  },
};

const base: WorkloadApp = {
  kind: "workload",
  name,
  podSpec: {
    securityContext: {
      runAsNonRoot: true,
      runAsUser: 2000,
      runAsGroup: 2000,
    },
    shareProcessNamespace: true,
    volumes: [
      {
        name: "tls",
        secret: {
          secretName: tlsSecretName,
        },
      },
    ],
    initContainers: [
      {
        name: "bootstrap",
        image: "docker.int.lab53.net/curlimages/curl:8.11.1",
        restartPolicy: "Always",
        command: ["/bin/sh", "-c"],
        args: [bootstrapScript],
        env: [
          {
            name: "ADMIN_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: adminSecretName,
                key: "admin-password",
              },
            },
          },
          {
            name: "USER_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: userSecretName,
                key: "user-password",
              },
            },
          },
          {
            name: "BOOTSTRAP_PAYLOAD",
            value: bootstrapPayload,
          },
          {
            name: "CREATE_USER_PAYLOAD",
            value: createUserPayload,
          },
        ],
        volumeMounts: [
          ...nasVolumeMounts([
            { mountPath: "/etc/stalwart", subPath: "cluster/stalwart/config" },
          ]),
          { name: "tls", mountPath: "/tls", readOnly: true },
        ],
      },
    ],
    containers: [
      {
        name: "main",
        image: "docker.int.lab53.net/stalwartlabs/stalwart:v0.16",
        ports: [{ name: "https", containerPort: 443 }],
        env: [
          {
            name: "ADMIN_PASSWORD",
            valueFrom: {
              secretKeyRef: {
                name: adminSecretName,
                key: "admin-password",
              },
            },
          },
          {
            name: "STALWART_RECOVERY_ADMIN",
            value: "admin:$(ADMIN_PASSWORD)",
          },
        ],
        readinessProbe: {
          httpGet: { path: "/login", port: 8080 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
        livenessProbe: {
          httpGet: { path: "/login", port: 8080 },
          initialDelaySeconds: 15,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        volumeMounts: [
          { name: "tls", mountPath: "/tls", readOnly: true },
        ],
      },
    ],
  },
  webPort: 443,
  externallyAccessible: true,
  extraResources: [
    ...buildGeneratedSecret(adminSecretName, ["admin-password"]),
    ...buildGeneratedSecret(userSecretName, ["user-password"]),
    tlsCertificate,
    backendTlsPolicy,
  ],
};

export default applyModifiers(
  base,
  withNasMounts({
    main: [
      { mountPath: "/opt/stalwart-mail", subPath: "cluster/stalwart/data" },
      { mountPath: "/etc/stalwart", subPath: "cluster/stalwart/config" },
    ],
  }),
);
