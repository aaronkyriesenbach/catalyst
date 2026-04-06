import { Deployment } from 'kubernetes-models/apps/v1';
import { Service } from 'kubernetes-models/v1';
import { HTTPRoute } from '@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1';
import { stringify } from 'yaml';
import type { AppConfig, StaticApp, WorkloadApp } from './types';

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

function buildDeployment(config: WorkloadApp) {
  const { name, podSpec } = config;

  return new Deployment({
    metadata: {
      name,
      labels: { app: name },
    },
    spec: {
      selector: {
        matchLabels: { app: name },
      },
      template: {
        metadata: {
          labels: { app: name },
        },
        spec: podSpec,
      },
    },
  });
}

function renderWorkload(config: WorkloadApp): string[] {
  const { name, podSpec, webPort, subDomain, externallyAccessible, extraResources } = config;
  const resources: string[] = extraResources?.map((r) => stringify(r)) ?? [];

  resources.push(stringify(buildDeployment(config)));

  const ports = podSpec.containers.flatMap((c) => c.ports ?? []);

  if (webPort && !ports.some((p) => p.containerPort === webPort)) {
    throw new Error('Web port provided but not in pod spec');
  }

  if (ports.length > 0) {
    const service = new Service({
      metadata: { name },
      spec: {
        selector: { app: name },
        ports: ports.map((p) => ({ port: p.containerPort, name: p.name })),
      },
    });

    resources.push(stringify(service));

    if (webPort) {
      const route = new HTTPRoute({
        metadata: { name },
        spec: {
          parentRefs: [{ name: 'traefik', namespace: 'traefik' }],
          hostnames: [
            `${subDomain ?? name}${externallyAccessible ? '' : '.int'}.lab53.net`,
          ],
          rules: [
            {
              backendRefs: [{ name, port: webPort }],
            },
          ],
        },
      });

      resources.push(stringify(route));
    }
  }

  return resources;
}

function renderStatic(config: StaticApp): string[] {
  return config.resources.map((r) => stringify(r));
}

export function renderAppFromConfig(config: AppConfig) {
  let resources: string[];

  switch (config.kind) {
    case 'workload':
      resources = renderWorkload(config);
      break;
    case 'static':
      resources = renderStatic(config);
      break;
  }

  console.log(resources.join('\n---\n'));
}
