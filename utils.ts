import { Deployment } from "kubernetes-models/apps/v1";
import { AppConfig } from "./types";
import { IContainer, IVolumeMount, Service } from "kubernetes-models/v1";
import { YAML } from "bun";
import { HTTPRoute } from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";

export async function loadAppConfig(path: string): Promise<AppConfig> {
  const mod = await import(`./apps/${path}`);

  return mod.default;
}

function buildDeployment(config: AppConfig) {
  const { name, podSpec, nasMounts } = config;

  const initialContainers = podSpec?.containers;

  if (!initialContainers) {
    throw new Error("Missing containers in pod spec");
  }

  const finalContainers: IContainer[] = [];
  if (nasMounts) {
    const containersToInject = Object.keys(nasMounts);
    const nonInjectedContainers = initialContainers.filter(
      (c) => !containersToInject.includes(c.name),
    );

    for (const [containerName, mountProps] of Object.entries(nasMounts)) {
      const containerToUpdate = initialContainers.find(
        (c) => c.name === containerName,
      );

      if (!containerToUpdate) {
        throw new Error(
          `Received volume mount config for container ${containerName}, but container does not exist`,
        );
      }

      const newVolumeMounts: IVolumeMount[] = mountProps.map((mount) => ({
        name: "nas",
        mountPath: mount.mountPath,
        subPath: mount.subPath,
      }));

      const updatedContainer: IContainer = {
        ...containerToUpdate,
        volumeMounts: [
          ...(containerToUpdate.volumeMounts || []),
          ...newVolumeMounts,
        ],
      };

      finalContainers.push(updatedContainer);
    }

    finalContainers.push(...nonInjectedContainers);
  } else {
    finalContainers.push(...initialContainers);
  }

  return new Deployment({
    metadata: {
      name,
      labels: {
        app: name,
      },
    },
    spec: {
      selector: {
        matchLabels: {
          app: name,
        },
      },
      template: {
        metadata: {
          labels: {
            app: name,
          },
        },
        spec: {
          securityContext: {
            runAsNonRoot: true,
          },
          ...podSpec,
          containers: finalContainers,
          volumes: nasMounts
            ? [
                ...(podSpec.volumes || []),
                {
                  name: "nas",
                  nfs: {
                    server: "192.168.53.120",
                    path: "/mnt/tank/data",
                  },
                },
              ]
            : podSpec.volumes,
        },
      },
    },
  });
}

export function renderAppFromConfig(config: AppConfig) {
  const {
    name,
    podSpec,
    webPort,
    subDomain,
    externallyAccessible,
    extraResources,
  } = config;
  const resources: string[] =
    extraResources?.map((r) => YAML.stringify(r)) ?? [];

  if (podSpec) {
    const deployment = buildDeployment(config);

    resources.push(YAML.stringify(deployment));

    const ports = podSpec.containers
      .map((c) => c.ports)
      .flat()
      .filter((p) => p !== undefined);

    if (webPort && !ports.map((p) => p.containerPort).includes(webPort)) {
      throw new Error("Web port provided but not in pod spec");
    }

    if (ports) {
      const service = new Service({
        metadata: {
          name,
        },
        spec: {
          selector: {
            app: name,
          },
          ports: ports.map((p) => ({ port: p.containerPort, name: p.name })),
        },
      });

      resources.push(YAML.stringify(service));

      if (webPort) {
        const route = new HTTPRoute({
          metadata: {
            name,
          },
          spec: {
            parentRefs: [
              {
                name: "traefik",
                namespace: "traefik",
              },
            ],
            hostnames: [
              `${subDomain ?? name}${externallyAccessible ? undefined : ".int"}.lab53.net`,
            ],
            rules: [
              {
                backendRefs: [
                  {
                    name: name,
                    port: webPort,
                  },
                ],
              },
            ],
          },
        });

        resources.push(YAML.stringify(route));
      }
    }
  }

  console.log(resources.join("\n---\n"));
}
