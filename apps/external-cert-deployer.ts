import { CronJob } from "kubernetes-models/batch/v1";
import { ConfigMap } from "kubernetes-models/v1";
import type { IEnvVar } from "kubernetes-models/v1";
import { ExternalSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import type { ExternalApp, ResourceLike, StaticApp } from "../types";
import {
  externalAppBackendCertSecretName,
  externalAppBackendHostname,
  externalAppDeployCredsSecretName,
  externalApps,
} from "./traefik/externalApps.config";
import { traefikNamespace } from "./traefik";
import { readFile } from "../utils";

type DeployApp = ExternalApp & {
  certDeploy: NonNullable<ExternalApp["certDeploy"]>;
};

const scriptConfigMapName = "external-cert-deployer-script";
const scriptFileName = "deploy-external-certs.ts";
const notifyConfigName = "cert-deploy-notify";
const awsStoreName = "aws-secrets-manager";
const image = "oven/bun:1.2";
const schedules = ["7 * * * *", "23 * * * *", "41 * * * *"];

const deployApps = externalApps.filter(
  (app): app is DeployApp => app.certDeploy !== undefined,
);

const scriptSource = await readFile(
  `../scripts/${scriptFileName}`,
  import.meta.url,
);

// base64 via binaryData so ArgoCD's CMP env-substitution can't strip the
// script's ${...} template literals; k8s decodes it back to the file on mount.
const scriptConfigMap = new ConfigMap({
  metadata: { name: scriptConfigMapName },
  binaryData: {
    [scriptFileName]: Buffer.from(scriptSource).toString("base64"),
  },
});

function secretEnv(name: string, secret: string, key: string): IEnvVar {
  return { name, valueFrom: { secretKeyRef: { name: secret, key } } };
}

function credentialEnv(app: DeployApp): IEnvVar[] {
  const secret = externalAppDeployCredsSecretName(app);

  switch (app.certDeploy.type) {
    case "proxmox":
      return [
        secretEnv("PROXMOX_TOKEN_ID", secret, "token-id"),
        secretEnv("PROXMOX_TOKEN_SECRET", secret, "token-secret"),
      ];
    case "truenas":
      return [secretEnv("TRUENAS_API_KEY", secret, "api-key")];
    case "unifi-local-api":
      return [
        secretEnv("UNIFI_USERNAME", secret, "username"),
        secretEnv("UNIFI_PASSWORD", secret, "password"),
      ];
  }
}

function buildCredentialsSecret(app: DeployApp): ExternalSecret {
  const name = externalAppDeployCredsSecretName(app);

  return new ExternalSecret({
    metadata: { name },
    spec: {
      refreshInterval: "1h",
      secretStoreRef: { name: awsStoreName, kind: "ClusterSecretStore" },
      target: { name },
      dataFrom: [{ extract: { key: `lab53/cluster0/${traefikNamespace}/${name}` } }],
    },
  });
}

function buildCronJob(app: DeployApp, schedule: string): CronJob {
  const target = {
    name: app.name,
    ipAddress: app.ipAddress,
    port: app.port,
    backendHostname: externalAppBackendHostname(app),
    strategy: app.certDeploy,
  };

  return new CronJob({
    metadata: { name: `${app.name}-cert-deploy` },
    spec: {
      schedule,
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          activeDeadlineSeconds: 300,
          template: {
            spec: {
              restartPolicy: "Never",
              automountServiceAccountToken: false,
              securityContext: {
                runAsNonRoot: true,
                runAsUser: 1000,
                runAsGroup: 1000,
              },
              containers: [
                {
                  name: "deploy",
                  image,
                  command: ["bun", "run", `/app/${scriptFileName}`],
                  env: [
                    { name: "DEPLOY_TARGET", value: JSON.stringify(target) },
                    ...credentialEnv(app),
                  ],
                  envFrom: [
                    { configMapRef: { name: notifyConfigName, optional: true } },
                  ],
                  volumeMounts: [
                    { name: "script", mountPath: "/app", readOnly: true },
                    { name: "cert", mountPath: "/certs", readOnly: true },
                  ],
                },
              ],
              volumes: [
                { name: "script", configMap: { name: scriptConfigMapName } },
                {
                  name: "cert",
                  secret: {
                    secretName: externalAppBackendCertSecretName(app),
                  },
                },
              ],
            },
          },
        },
      },
    },
  });
}

const resources: ResourceLike[] = [
  scriptConfigMap,
  ...deployApps.flatMap((app, index) => [
    buildCredentialsSecret(app),
    buildCronJob(app, schedules[index % schedules.length] ?? "0 * * * *"),
  ]),
];

const config: StaticApp = {
  kind: "static",
  name: "external-cert-deployer",
  namespace: traefikNamespace,
  resources,
};

export default config;
