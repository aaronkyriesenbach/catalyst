import { ExternalSecret } from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import { CronJob } from "kubernetes-models/batch/v1";
import type { IEnvVar } from "kubernetes-models/v1";
import { Project } from "../constants";
import type { ExternalApp, ResourceLike, StaticApp } from "../types";
import {
  AWS_STORE,
  awsRemoteKey,
  buildFileConfigMap,
  readFile,
  image,
} from "../utils";
import { appriseNotifiers, appriseUrl } from "./apprise";
import { healthchecksUrl } from "./healthchecks";
import { traefikNamespace } from "./traefik";
import {
  externalAppBackendCertSecretName,
  externalAppBackendHostname,
  externalAppDeployCredsSecretName,
  externalApps,
} from "./traefik/externalApps.config";

type DeployApp = ExternalApp & {
  certDeploy: NonNullable<ExternalApp["certDeploy"]>;
};

const scriptConfigMapName = "external-cert-deployer-script";
const scriptFileName = "deploy-external-certs.ts";
const appName = "external-cert-deployer";
const pingKeySecretName = "healthchecks-ping-key";
const awsStoreName = "aws-secrets-manager";
const imageRef = image("bun");

if (!appriseNotifiers.includes(appName)) {
  throw new Error(`${appName} has no Apprise config in apps/apprise.ts`);
}
const schedules = ["7 * * * *", "23 * * * *", "41 * * * *"];

const deployApps = externalApps.filter(
  (app): app is DeployApp => app.certDeploy !== undefined,
);

const scriptConfigMap = buildFileConfigMap(scriptConfigMapName, {
  [scriptFileName]: await readFile(
    `../scripts/${scriptFileName}`,
    import.meta.url,
  ),
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

// Created after Healthchecks is up; until then the optional env skips pings.
const pingKeySecret = new ExternalSecret({
  metadata: { name: pingKeySecretName },
  spec: {
    refreshInterval: "1h",
    secretStoreRef: AWS_STORE,
    target: { name: pingKeySecretName },
    data: [
      {
        secretKey: "ping-key",
        remoteRef: {
          key: awsRemoteKey(traefikNamespace, pingKeySecretName),
          property: "ping-key",
        },
      },
    ],
  },
});

function cronJobName(app: DeployApp): string {
  return `${app.name}-cert-deploy`;
}

function notifyEnv(app: DeployApp): IEnvVar[] {
  return [
    { name: "APPRISE_URL", value: appriseUrl },
    { name: "APPRISE_KEY", value: appName },
    { name: "HEALTHCHECK_URL", value: `${healthchecksUrl}/ping` },
    { name: "HEALTHCHECK_SLUG", value: cronJobName(app) },
    {
      name: "HEALTHCHECK_PING_KEY",
      valueFrom: {
        secretKeyRef: {
          name: pingKeySecretName,
          key: "ping-key",
          optional: true,
        },
      },
    },
  ];
}

function buildCredentialsSecret(app: DeployApp): ExternalSecret {
  const name = externalAppDeployCredsSecretName(app);

  return new ExternalSecret({
    metadata: { name },
    spec: {
      refreshInterval: "1h",
      secretStoreRef: { name: awsStoreName, kind: "ClusterSecretStore" },
      target: { name },
      dataFrom: [
        {
          extract: {
            key: `lab53/cluster0/${traefikNamespace}/${name}`,
          },
        },
      ],
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
    metadata: { name: cronJobName(app) },
    spec: {
      schedule,
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 1,
          activeDeadlineSeconds: 600,
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
                  image: imageRef,
                  command: ["bun", "run", `/app/${scriptFileName}`],
                  env: [
                    {
                      name: "DEPLOY_TARGET",
                      value: JSON.stringify(target),
                    },
                    ...credentialEnv(app),
                    ...notifyEnv(app),
                  ],
                  volumeMounts: [
                    {
                      name: "script",
                      mountPath: "/app",
                      readOnly: true,
                    },
                    {
                      name: "cert",
                      mountPath: "/certs",
                      readOnly: true,
                    },
                  ],
                },
              ],
              volumes: [
                {
                  name: "script",
                  configMap: { name: scriptConfigMapName },
                },
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
  pingKeySecret,
  ...deployApps.flatMap((app, index) => [
    buildCredentialsSecret(app),
    buildCronJob(app, schedules[index % schedules.length] ?? "0 * * * *"),
  ]),
];

const config: StaticApp = {
  kind: "static",
  name: appName,
  namespace: traefikNamespace,
  project: Project.SYSTEM,
  resources,
};

export default config;
