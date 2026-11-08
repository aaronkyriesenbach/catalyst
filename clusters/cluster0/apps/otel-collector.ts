import { Project } from "@catalyst/core/constants";
import { StatusGroup, tcpTarget } from "@catalyst/platform/status";
import type { StaticApp } from "@catalyst/core/types";
import { mergeValues } from "@catalyst/core/yaml";
import { mirrorRepository } from "@catalyst/versions/images";
import { readYaml } from "@catalyst/core/files";
import { buildScrapeConfig, scrapeTargets } from "./otel-collector/targets";
import {
  monitoringNamespace,
  vlSingleUrl,
  vmSingleUrl,
  vtSingleUrl,
} from "./victoria-metrics/endpoints";

const name = "otel-collector";
const collectorImage = mirrorRepository(
  "docker.io/otel/opentelemetry-collector-k8s",
);

const queue = {
  enabled: true,
  storage: "file_storage/queue",
  queue_size: 5000,
};

const gatewayValues = mergeValues(
  await readYaml("./otel-collector/gateway.yaml", import.meta.url),
  {
    config: {
      receivers: {
        prometheus: {
          config: {
            scrape_configs: [
              ...scrapeTargets.map(buildScrapeConfig),
              {
                job_name: "otel-collector",
                scrape_interval: "30s",
                static_configs: [{ targets: ["${env:MY_POD_IP}:8888"] }],
              },
            ],
          },
        },
      },
      exporters: {
        "otlphttp/metrics": {
          endpoint: `${vmSingleUrl}/opentelemetry`,
          sending_queue: queue,
        },
        "otlphttp/logs": {
          endpoint: `${vlSingleUrl}/insert/opentelemetry`,
          // Without this VictoriaLogs makes every resource attribute a stream field.
          headers: {
            "VL-Stream-Fields":
              "k8s.namespace.name,k8s.pod.name,k8s.container.name",
          },
          sending_queue: queue,
        },
        "otlphttp/traces": {
          endpoint: `${vtSingleUrl}/insert/opentelemetry`,
          sending_queue: queue,
        },
      },
    },
  },
);

const config: StaticApp = {
  kind: "static",
  name,
  namespace: monitoringNamespace,
  project: Project.SYSTEM,
  status: {
    targets: [
      tcpTarget(
        "Telemetry Gateway",
        StatusGroup.Platform,
        `otel-gateway.${monitoringNamespace}.svc`,
        4318,
      ),
    ],
  },
  helmReleases: [
    {
      chart: "opentelemetryCollector",
      releaseName: "otel-agent",
      values: await readYaml("./otel-collector/agent.yaml", import.meta.url),
      parameters: { "image.repository": collectorImage },
    },
    {
      chart: "opentelemetryCollector",
      releaseName: "otel-gateway",
      values: gatewayValues,
      skipCrds: true,
      parameters: { "image.repository": collectorImage },
    },
  ],
};

export default config;
