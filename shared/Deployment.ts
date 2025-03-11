import { EnvVar, KubeDeployment, Volume } from "./imports/k8s";
import { Construct } from "constructs";
import { AppProps } from "./AppProps";

export default class Deployment extends KubeDeployment {
    constructor(scope: Construct, id: string, props: AppProps) {
        const { appName, containers, volumes, createNASVolume, replicas, revisionHistoryLimit } = props;

        const nasVolume: Volume | undefined = createNASVolume ? {
            name: (typeof createNASVolume === 'string' ? createNASVolume : DEFAULT_NAS_VOLUME_NAME),
            nfs: {
                server: "192.168.4.84",
                path: "/mnt/rpool/data"
            }
        } : undefined;

        const createVolumes = nasVolume ? [nasVolume, ...(volumes ?? [])] : volumes

        super(scope, id, {
            metadata: {
                name: appName
            },
            spec: {
                selector: { matchLabels: { app: appName } },
                replicas: replicas ?? 1,
                revisionHistoryLimit: revisionHistoryLimit ?? 1,
                template: {
                    metadata: { labels: { app: appName } },
                    spec: {
                        volumes: createVolumes,
                        containers: containers
                    }
                }
            }
        });
    }
}

export const DEFAULT_NAS_VOLUME_NAME = "nas-volume";
export const DEFAULT_LSCR_ENV_EXPORTS: EnvVar[] = [
    {
        name: "PUID",
        value: "1000"
    },
    {
        name: "PGID",
        value: "1000"
    },
    {
        name: "TZ",
        value: "America/New_York"
    }
];