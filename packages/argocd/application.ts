import {
  Application,
  AppProject,
} from "@kubernetes-models/argo-cd/argoproj.io/v1alpha1";
import { helmReleaseNamespaces } from "@catalyst/core/constants";
import { appNamespace } from "@catalyst/core/apps";
import type { AppConfig, HelmRelease, ProjectSpec } from "@catalyst/core/types";
import { helmCharts, type HelmChartEntry } from "@catalyst/versions/versions";

const REPO_URL = "https://github.com/aaronkyriesenbach/catalyst";

type ApplicationSource = NonNullable<Application["spec"]["sources"]>[number];

const OCI_PREFIX = "oci://";

/** Argo wants OCI `repoURL`s without the scheme, with the chart name split off. */
export function splitOciChart(chart: `oci://${string}`): {
  repoURL: string;
  chart: string;
} {
  const ref = chart.slice(OCI_PREFIX.length);
  const lastSlash = ref.lastIndexOf("/");

  return {
    repoURL: ref.slice(0, lastSlash),
    chart: ref.slice(lastSlash + 1),
  };
}

function buildHelmSource(release: HelmRelease): ApplicationSource {
  const entry: HelmChartEntry = helmCharts[release.chart];
  const location =
    entry.kind === "repo"
      ? { repoURL: entry.repo, chart: entry.chart }
      : splitOciChart(entry.chart);
  const parameters = Object.entries(release.parameters ?? {}).map(
    ([name, value]) => ({ name, value }),
  );

  return {
    ...location,
    targetRevision: entry.version,
    helm: {
      releaseName: release.releaseName,
      ...(release.skipCrds && { skipCrds: true }),
      ...(release.values !== undefined && {
        valuesObject: release.values,
      }),
      ...(parameters.length > 0 && { parameters }),
    },
  };
}

function hasCmpContent(config: AppConfig): boolean {
  if (config.kind === "workload") {
    return true;
  }

  return (
    (config.resources?.length ?? 0) > 0 ||
    (config.remoteResources?.length ?? 0) > 0
  );
}

function assertHelmReleaseNamespaces(
  config: AppConfig,
  destinationNamespace: string,
): void {
  for (const { releaseName } of config.helmReleases ?? []) {
    const pinned = helmReleaseNamespaces[releaseName];

    if (pinned !== undefined && pinned !== destinationNamespace) {
      throw new Error(
        `Helm release '${releaseName}' is installed in '${pinned}' but app '${config.name}' targets '${destinationNamespace}'`,
      );
    }
  }
}

export function buildApplication(config: AppConfig): Application {
  const { name, project, helmReleases, ignoreDifferences, autoSync } = config;
  const destinationNamespace = appNamespace(config);

  assertHelmReleaseNamespaces(config, destinationNamespace);

  const cmpSource: ApplicationSource = {
    repoURL: REPO_URL,
    path: ".",
    plugin: {
      env: [{ name: "APP", value: name }],
    },
  };
  const helmSources = (helmReleases ?? []).map(buildHelmSource);
  const hasHelm = helmSources.length > 0;
  const serverSideApply = hasHelm || config.serverSideApply === true;
  const cmpSources = !hasHelm || hasCmpContent(config) ? [cmpSource] : [];

  return new Application({
    metadata: {
      name,
      namespace: "argocd",
      finalizers: ["resources-finalizer.argocd.argoproj.io"],
      // ServerSideApply leaves no last-applied annotation, so client-side diffs
      // report API-defaulted fields (HTTPRoute, ExternalSecret, ...) as drift.
      ...(serverSideApply && {
        annotations: {
          "argocd.argoproj.io/compare-options": "ServerSideDiff=true",
        },
      }),
    },
    spec: {
      project: project ?? "default",
      ...(hasHelm
        ? { sources: [...cmpSources, ...helmSources] }
        : { source: cmpSource }),
      destination: {
        server: "https://kubernetes.default.svc",
        namespace: destinationNamespace,
      },
      syncPolicy: {
        ...(autoSync !== false && {
          automated: { prune: true, selfHeal: false },
        }),
        syncOptions: [
          "CreateNamespace=true",
          ...(serverSideApply ? ["ServerSideApply=true"] : []),
        ],
        retry: {
          limit: 5,
          backoff: { duration: "30s", factor: 2, maxDuration: "5m" },
        },
      },
      ...(ignoreDifferences !== undefined && { ignoreDifferences }),
    },
  });
}

export function buildProject(name: string, spec: ProjectSpec): AppProject {
  return new AppProject({
    metadata: {
      name,
      namespace: "argocd",
      annotations: { "argocd.argoproj.io/sync-wave": "-1" },
    },
    spec,
  });
}
