import { CronJob } from "kubernetes-models/batch/v1";
import type { IContainer } from "kubernetes-models/v1";
import type { ResourceLike } from "@catalyst/core/types";
import { buildGeneratedSecret } from "@catalyst/k8s/secrets";
import { buildFileConfigMap } from "@catalyst/k8s/workload";
import { image } from "@catalyst/versions/images";
import {
  recoveryAdminSecretName,
  recoveryAdminUser,
  stalwartName,
  stalwartServiceUrl,
} from "./common";
import { buildStalwartPlan } from "./plan";

const name = `${stalwartName}-config`;
const planConfigMap = `${name}-plan`;
const NONROOT_UID = 65532;
const CLI_CACHE_DIR = "/home/nonroot/.cache";

const recoveryAdminSecret = buildGeneratedSecret(
  stalwartName,
  recoveryAdminSecretName,
  [{ key: "password", length: 32, alphanumeric: true }],
  {
    persist: true,
    template: {
      engineVersion: "v2",
      data: {
        STALWART_RECOVERY_ADMIN: `${recoveryAdminUser}:{{ .password }}`,
        password: "{{ .password }}",
      },
    },
  },
);

const plan = buildFileConfigMap(planConfigMap, {
  "plan.ndjson": buildStalwartPlan(),
});

const cli = (containerName: string, args: string[]): IContainer => ({
  name: containerName,
  image: image("stalwartCli"),
  args,
  env: [
    { name: "STALWART_URL", value: stalwartServiceUrl },
    { name: "STALWART_USER", value: recoveryAdminUser },
    {
      name: "STALWART_PASSWORD",
      valueFrom: {
        secretKeyRef: { name: recoveryAdminSecretName, key: "password" },
      },
    },
  ],
  securityContext: {
    allowPrivilegeEscalation: false,
    readOnlyRootFilesystem: true,
    capabilities: { drop: ["ALL"] },
  },
  volumeMounts: [
    { name: "plan", mountPath: "/plan", readOnly: true },
    { name: "cache", mountPath: CLI_CACHE_DIR },
  ],
});

const cronJob = new CronJob({
  metadata: { name },
  spec: {
    schedule: "*/10 * * * *",
    concurrencyPolicy: "Forbid",
    successfulJobsHistoryLimit: 1,
    failedJobsHistoryLimit: 3,
    jobTemplate: {
      spec: {
        backoffLimit: 3,
        activeDeadlineSeconds: 600,
        template: {
          spec: {
            restartPolicy: "Never",
            automountServiceAccountToken: false,
            securityContext: {
              runAsNonRoot: true,
              runAsUser: NONROOT_UID,
              runAsGroup: NONROOT_UID,
              seccompProfile: { type: "RuntimeDefault" },
            },
            initContainers: [
              cli("apply", ["apply", "--file", "/plan/plan.ndjson"]),
            ],
            containers: [
              cli("reload", [
                "create",
                "Action/ReloadSettings",
                "--json",
                "{}",
              ]),
            ],
            volumes: [
              { name: "plan", configMap: { name: planConfigMap } },
              { name: "cache", emptyDir: {} },
            ],
          },
        },
      },
    },
  },
});

export const stalwartConfigResources: ResourceLike[] = [
  ...recoveryAdminSecret,
  plan,
  cronJob,
];
