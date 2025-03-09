import { KubePod, KubePodProps, Volume } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";
import { AppProps } from "./AppProps.ts";
import { DEFAULT_NAS_VOLUME_NAME } from "./constants.ts";

export function getPodSpec(props: AppProps): KubePodProps {
  const {
    appName,
    containers,
    initContainers,
    volumes,
    createNASVolume,
    podRestartPolicy,
  } = props;

  const nasVolume: Volume | undefined = createNASVolume
    ? {
      name: (typeof createNASVolume === "string"
        ? createNASVolume
        : DEFAULT_NAS_VOLUME_NAME),
      nfs: {
        server: "192.168.4.84",
        path: "/mnt/rpool/data",
      },
    }
    : undefined;

  const createVolumes = nasVolume ? [nasVolume, ...(volumes ?? [])] : volumes;

  return {
    metadata: {
      name: appName,
      labels: { app: appName },
    },
    spec: {
      volumes: createVolumes,
      containers: containers,
      initContainers: initContainers,
      restartPolicy: podRestartPolicy,
    },
  };
}

export default class Pod extends KubePod {
  constructor(scope: Construct, id: string, props: AppProps) {
    const podSpec: KubePodProps = getPodSpec(props);

    super(scope, id, podSpec);
  }
}
