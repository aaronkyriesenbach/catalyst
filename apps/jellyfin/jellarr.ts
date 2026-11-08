import { CronJob } from "kubernetes-models/batch/v1";
import type { ResourceLike } from "../../types";
import {
  awsRemoteKey,
  buildAwsExternalSecret,
  buildFileConfigMap,
  image,
} from "../../utils";
import { restrictedContainer } from "../arr/common";
import { jellyfinName } from "./common";
import { buildJellarrYaml } from "./jellarr.config";

const name = "jellarr";
const configMapName = `${name}-config`;
const secretName = `${name}-credentials`;

const apiKeySecret = buildAwsExternalSecret(secretName, [
  {
    remoteKey: awsRemoteKey(jellyfinName, secretName),
    property: "api-key",
    secretKey: "api-key",
  },
]);

const configMap = buildFileConfigMap(configMapName, {
  "config.yml": buildJellarrYaml(),
});

const cronJob = new CronJob({
  metadata: { name },
  spec: {
    schedule: "*/15 * * * *",
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
              seccompProfile: { type: "RuntimeDefault" },
            },
            containers: [
              {
                name,
                image: image("jellarr"),
                args: ["--configFile", "/config/config.yml"],
                env: [
                  {
                    name: "JELLARR_API_KEY",
                    valueFrom: {
                      secretKeyRef: { name: secretName, key: "api-key" },
                    },
                  },
                ],
                securityContext: restrictedContainer({
                  readOnlyRootFilesystem: true,
                }),
                volumeMounts: [
                  { name: "config", mountPath: "/config", readOnly: true },
                  { name: "tmp", mountPath: "/tmp" },
                ],
              },
            ],
            volumes: [
              { name: "config", configMap: { name: configMapName } },
              { name: "tmp", emptyDir: {} },
            ],
          },
        },
      },
    },
  },
});

export const jellarrResources: ResourceLike[] = [
  apiKeySecret,
  configMap,
  cronJob,
];
