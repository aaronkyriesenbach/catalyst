import { CronJob } from "kubernetes-models/batch/v1";
import type { ResourceLike } from "../../types";
import { buildFileConfigMap, image } from "../../utils";
import { restrictedContainer, timezone } from "./common";
import { buildConfigarrYaml, configarrEnvNames } from "./configarr.config";
import { API_KEY_SECRET_KEY, apiKeySecretName } from "./servarr";
import { sabnzbdApiKeySecret } from "./sabnzbd";

const name = "configarr";
const configMapName = `${name}-config`;
const workDir = "/work";

const apiKeyEnv = (envName: string, secret: string, key: string) => ({
  name: envName,
  valueFrom: { secretKeyRef: { name: secret, key } },
});

const configMap = buildFileConfigMap(configMapName, {
  "config.yml": buildConfigarrYaml(),
});

// Runs every 15 minutes rather than once, so the apps converge on first boot (they start empty and
// unreachable) and anything edited in a UI is put back.
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
                image: image("configarr"),
                env: [
                  { name: "TZ", value: timezone },
                  // The image keeps its working files under the CWD, which is read-only for a non-root user.
                  { name: "ROOT_PATH", value: workDir },
                  { name: "HOME", value: workDir },
                  { name: "CONFIG_LOCATION", value: "/config/config.yml" },
                  { name: "LOG_LEVEL", value: "info" },
                  { name: "TELEMETRY_ENABLED", value: "false" },
                  ...(["radarr", "sonarr", "lidarr", "prowlarr"] as const).map(
                    (app) =>
                      apiKeyEnv(
                        configarrEnvNames[app],
                        apiKeySecretName(app),
                        API_KEY_SECRET_KEY,
                      ),
                  ),
                  apiKeyEnv(
                    configarrEnvNames.sabnzbd,
                    sabnzbdApiKeySecret.name,
                    sabnzbdApiKeySecret.key,
                  ),
                ],
                securityContext: restrictedContainer({
                  readOnlyRootFilesystem: true,
                }),
                volumeMounts: [
                  { name: "work", mountPath: workDir },
                  { name: "config", mountPath: "/config", readOnly: true },
                ],
              },
            ],
            volumes: [
              { name: "work", emptyDir: {} },
              { name: "config", configMap: { name: configMapName } },
            ],
          },
        },
      },
    },
  },
});

export const configarrResources: ResourceLike[] = [configMap, cronJob];
