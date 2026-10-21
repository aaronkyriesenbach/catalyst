import { monitoringNamespace } from "../victoria-metrics/endpoints";

type TargetBase = {
  job: string;
  namespace: string;
  port: string;
  path?: string;
  dropMetrics?: string;
  /** Regex over "<metric>;<le>" for histogram buckets to drop. */
  dropBuckets?: string;
  interval?: string;
  dropLabels?: string;
  honorLabels?: boolean;
};

type ServiceTarget = TargetBase & {
  kind: "service";
  labels?: Record<string, string>;
  serviceName?: string;
  https?: boolean;
};

type PodTarget = TargetBase & {
  kind: "pod";
  labels: Record<string, string>;
};

export type ScrapeTarget = ServiceTarget | PodTarget;

const serviceAccount = "/var/run/secrets/kubernetes.io/serviceaccount";

// Histograms with no dashboard or rule consumer; they dominate the apiserver series count.
const apiserverNoise = [
  "etcd_request_duration_seconds_bucket",
  "apiserver_request_slo_duration_seconds_bucket",
  "apiserver_request_body_size_bytes_bucket",
  "apiserver_response_sizes_bucket",
  "apiserver_watch_events_sizes_bucket",
  "apiserver_watch_list_duration_seconds_bucket",
  "apiserver_watch_cache_read_wait_seconds_bucket",
  "kubelet_.*",
  "volume_manager_.*",
  "storage_operation_.*",
  "prober_.*",
  "csi_.*",
].join("|");

// The SLO burn-rate rules count requests under the 1, 5 and 30 second buckets, so those must stay.
const apiserverBuckets =
  "(apiserver_request|apiserver_request_sli|etcd_request)_duration_seconds_bucket;(0.15|0.25|0.3|0.35|0.4|0.45|0.6|0.7|0.8|0.9|1.25|1.5|1.75|2.5|3|3.5|4.5|6|7|8|9|15|25|50)";

const victoriaService = (job: string): ServiceTarget => ({
  kind: "service",
  job,
  namespace: monitoringNamespace,
  labels: { "app.kubernetes.io/name": job },
  port: "http|web",
});

export const scrapeTargets: readonly ScrapeTarget[] = [
  {
    kind: "service",
    job: "kube-state-metrics",
    namespace: monitoringNamespace,
    labels: { "app.kubernetes.io/name": "kube-state-metrics" },
    port: "http",
    honorLabels: true,
    dropLabels: "uid|container_id|image_id",
  },
  {
    kind: "service",
    job: "apiserver",
    namespace: "default",
    serviceName: "kubernetes",
    port: "https",
    https: true,
    honorLabels: true,
    interval: "60s",
    dropMetrics: apiserverNoise,
    dropBuckets: apiserverBuckets,
  },
  {
    kind: "service",
    job: "coredns",
    namespace: "kube-system",
    serviceName: "kube-dns",
    port: "metrics",
  },
  victoriaService("vmsingle"),
  victoriaService("vlsingle"),
  victoriaService("vtsingle"),
  victoriaService("vmalert"),
  victoriaService("vmalertmanager"),
  {
    kind: "service",
    job: "victoria-metrics-operator",
    namespace: monitoringNamespace,
    labels: { "app.kubernetes.io/name": "victoria-metrics-operator" },
    port: "http",
  },
  {
    kind: "service",
    job: "grafana",
    namespace: monitoringNamespace,
    labels: { "app.kubernetes.io/name": "grafana" },
    port: "service",
  },
  {
    kind: "service",
    job: "cert-manager",
    namespace: "cert-manager",
    labels: {
      "app.kubernetes.io/name": "cert-manager|cainjector|webhook|trust-manager",
    },
    port: "http-metrics|metrics",
  },
  {
    kind: "service",
    job: "crowdsec",
    namespace: "crowdsec",
    serviceName: "crowdsec-service|crowdsec-appsec-service",
    port: "metrics",
  },
  {
    kind: "pod",
    job: "traefik",
    namespace: "traefik",
    labels: { "app.kubernetes.io/name": "traefik" },
    port: "metrics",
  },
];

type Relabel = Record<string, unknown>;

// Prometheus exposes a label `a.b/c` as `__meta_kubernetes_*_label_a_b_c`.
const metaLabel = (kind: "service" | "pod", label: string) =>
  `__meta_kubernetes_${kind}_label_${label.replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;

function keepRules(target: ScrapeTarget): Relabel[] {
  const labelRules = Object.entries(target.labels ?? {}).map(
    ([label, regex]) => ({
      action: "keep",
      source_labels: [metaLabel(target.kind, label)],
      regex,
    }),
  );

  if (target.kind === "pod") {
    return [
      ...labelRules,
      {
        action: "keep",
        source_labels: ["__meta_kubernetes_pod_container_port_name"],
        regex: target.port,
      },
    ];
  }

  return [
    ...labelRules,
    ...(target.serviceName === undefined
      ? []
      : [
          {
            action: "keep",
            source_labels: ["__meta_kubernetes_service_name"],
            regex: target.serviceName,
          },
        ]),
    {
      action: "keep",
      source_labels: ["__meta_kubernetes_endpoint_port_name"],
      regex: target.port,
    },
  ];
}

function identityLabels(target: ScrapeTarget): Relabel[] {
  return [
    {
      source_labels: ["__meta_kubernetes_namespace"],
      target_label: "namespace",
    },
    { source_labels: ["__meta_kubernetes_pod_name"], target_label: "pod" },
    ...(target.kind === "service"
      ? [
          {
            source_labels: ["__meta_kubernetes_service_name"],
            target_label: "service",
          },
        ]
      : []),
    { target_label: "job", replacement: target.job },
  ];
}

export function buildScrapeConfig(target: ScrapeTarget) {
  const metricRelabel: Relabel[] = [
    ...(target.dropLabels === undefined
      ? []
      : [{ action: "labeldrop", regex: target.dropLabels }]),
    ...(target.dropBuckets === undefined
      ? []
      : [
          {
            action: "drop",
            source_labels: ["__name__", "le"],
            regex: target.dropBuckets,
          },
        ]),
    ...(target.dropMetrics === undefined
      ? []
      : [
          {
            action: "drop",
            source_labels: ["__name__"],
            regex: target.dropMetrics,
          },
        ]),
  ];

  return {
    job_name: `${target.job}-${target.kind}`,
    scrape_interval: target.interval ?? "30s",
    ...(target.path === undefined ? {} : { metrics_path: target.path }),
    ...(target.honorLabels ? { honor_labels: true } : {}),
    ...(target.kind === "service" && target.https
      ? {
          scheme: "https",
          authorization: {
            credentials_file: `${serviceAccount}/token`,
          },
          tls_config: {
            ca_file: `${serviceAccount}/ca.crt`,
            server_name: "kubernetes",
          },
        }
      : {}),
    kubernetes_sd_configs: [
      {
        role: target.kind === "service" ? "endpoints" : "pod",
        namespaces: { names: [target.namespace] },
      },
    ],
    relabel_configs: [...keepRules(target), ...identityLabels(target)],
    ...(metricRelabel.length > 0
      ? { metric_relabel_configs: metricRelabel }
      : {}),
  };
}
