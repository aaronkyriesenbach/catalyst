import { parseAllDocuments } from "yaml";
import type { IPodSecurityContext } from "kubernetes-models/v1";
import { buildForwardAuthMiddleware } from "@catalyst/platform/auth";
import { buildWafMiddleware, resolveWaf } from "@catalyst/platform/waf";
import { buildRoute } from "@catalyst/k8s/route";
import { buildDeployment, buildService } from "@catalyst/k8s/workload";
import type { AppConfig, StaticApp, WorkloadApp } from "./types";
import { toYaml } from "./yaml";

const defaultSecurityContext: IPodSecurityContext = {
  runAsNonRoot: true,
  runAsUser: 1000,
  runAsGroup: 1000,
  fsGroup: 1000,
  // Skips the recursive chown on every mount of a volume that is already correct.
  fsGroupChangePolicy: "OnRootMismatch",
};

function renderWorkload(config: WorkloadApp): string[] {
  const app = config.podSpec.securityContext
    ? config
    : {
        ...config,
        podSpec: {
          ...config.podSpec,
          securityContext: defaultSecurityContext,
        },
      };

  const {
    name,
    podSpec,
    webPort,
    subDomain,
    externallyAccessible,
    extraResources,
  } = app;
  const resources: string[] = [];
  const waf = externallyAccessible ? (app.waf ?? {}) : app.waf;
  const resolvedWaf = resolveWaf(name, externallyAccessible, app.waf);

  if (extraResources) {
    resources.push(...extraResources.map((r) => toYaml(r)));
  }

  if (resolvedWaf) {
    resources.push(toYaml(buildWafMiddleware(resolvedWaf)));
  }

  const authentikForwardAuth = app.oidc?.kind === "proxy";

  if (authentikForwardAuth) {
    resources.push(toYaml(buildForwardAuthMiddleware()));
  }

  resources.push(
    toYaml(
      buildDeployment(name, podSpec, {
        strategy: app.strategy,
        replicas: app.replicas,
        progressDeadlineSeconds: app.progressDeadlineSeconds,
        probeExempt: app.probeExempt,
      }),
    ),
  );

  const ports = podSpec.containers.flatMap((c) => c.ports ?? []);

  if (webPort && !ports.some((p) => p.containerPort === webPort)) {
    throw new Error("Web port provided but not in pod spec");
  }

  if (ports.length > 0) {
    const service = buildService(
      name,
      ports.map((p) => ({
        port: p.containerPort,
        name: p.name,
        protocol: p.protocol,
      })),
    );

    resources.push(toYaml(service));

    if (webPort) {
      const route = buildRoute(name, webPort, {
        subDomain,
        externallyAccessible,
        authentikForwardAuth,
        waf,
      });
      resources.push(toYaml(route));
    }
  }

  return resources;
}

function withAnnotations(
  doc: Record<string, unknown>,
  annotations: Record<string, string> | undefined,
): Record<string, unknown> {
  if (annotations === undefined) {
    return doc;
  }

  const metadata = (doc.metadata ?? {}) as {
    annotations?: Record<string, string>;
  };

  return {
    ...doc,
    metadata: {
      ...metadata,
      annotations: { ...metadata.annotations, ...annotations },
    },
  };
}

async function renderStatic(
  config: StaticApp,
  fetchRemote: boolean,
): Promise<string[]> {
  const results = config.resources?.map((r) => toYaml(r)) ?? [];

  for (const url of fetchRemote ? (config.remoteResources ?? []) : []) {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
      );
    }

    const text = await response.text();
    const docs = parseAllDocuments(text)
      .map((doc) => doc.toJSON() as Record<string, unknown>)
      .filter(Boolean);

    results.push(
      ...docs.map((d) =>
        toYaml(withAnnotations(d, config.remoteResourceAnnotations)),
      ),
    );
  }

  return results;
}

export async function renderApp(
  config: AppConfig,
  options: { fetchRemote?: boolean } = {},
): Promise<string[]> {
  switch (config.kind) {
    case "workload":
      return renderWorkload(config);
    case "static":
      return renderStatic(config, options.fetchRemote ?? true);
  }
}

export async function renderAppFromConfig(config: AppConfig) {
  console.log((await renderApp(config)).join("\n---\n"));
}
