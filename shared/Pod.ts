import { KubePod, PodSpec, Volume } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";
import { NAS_VOLUME_SPEC } from "./constants.ts";
import { injectContainers } from "./helpers.ts";

export function getPodSpec(props: PodSpecProps): PodSpec {
  const {
    containers,
    initContainers,
    volumes,
    nasVolumeMounts,
  } = props;

  const createVolumes = nasVolumeMounts
    ? [NAS_VOLUME_SPEC as Volume, ...(volumes ?? [])]
    : volumes;

  const injectedContainers = injectContainers(containers, nasVolumeMounts);
  const injectedInitContainers = injectContainers(
    initContainers,
    nasVolumeMounts,
  );

  return {
    ...props,
    volumes: createVolumes,
    containers: injectedContainers!, // We know that containers will be defined because they must be defined as inputs to this function
    initContainers: injectedInitContainers,
  };
}

export default class Pod extends KubePod {
  constructor(scope: Construct, props: PodProps) {
    const { name, podSpecProps } = props;

    const podSpec = getPodSpec(podSpecProps);

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: podSpec,
    });
  }
}

export type PodProps = {
  name: string;
  podSpecProps: PodSpecProps;
};

export type PodSpecProps = PodSpec & {
  nasVolumeMounts?: NasVolumeMountMap;
};

export type NasVolumeMountMap = {
  [containerName: string]: NasVolumeMount[];
};

export type NasVolumeMount = {
  mountPath: string;
  subPath?: string;
};
