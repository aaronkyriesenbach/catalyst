import * as pulumi from "@pulumi/pulumi";
import * as talos from "@pulumiverse/talos";

export type TalosNode = {
  readonly name: string;
  readonly ip: string;
  readonly controlPlane: boolean;
};

export type TalosClusterArgs = {
  readonly clusterName: string;
  readonly apiVip: string;
  readonly nodes: readonly TalosNode[];
  readonly talosVersion: string;
  readonly kubernetesVersion: string;
  readonly patches: {
    readonly all: readonly pulumi.Input<string>[];
    readonly controlPlane: readonly pulumi.Input<string>[];
    readonly node: (node: TalosNode) => pulumi.Input<string>;
  };
};

export class TalosCluster extends pulumi.ComponentResource {
  readonly kubeconfig: pulumi.Output<string>;
  readonly talosconfig: pulumi.Output<string>;
  readonly ready: pulumi.Resource[];

  constructor(
    name: string,
    args: TalosClusterArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super("catalyst:infra:TalosCluster", name, {}, opts);
    const parent = { parent: this };

    const secrets = new talos.machine.Secrets(
      `${name}-secrets`,
      { talosVersion: args.talosVersion },
      parent,
    );

    const controlPlaneIps = args.nodes
      .filter((node) => node.controlPlane)
      .map((node) => node.ip);
    const firstControlPlane = controlPlaneIps[0];

    if (firstControlPlane === undefined) {
      throw new Error(`${name}: at least one control-plane node is required`);
    }

    const applies = args.nodes.map((node) => {
      const configuration = talos.machine.getConfigurationOutput({
        clusterName: args.clusterName,
        clusterEndpoint: `https://${args.apiVip}:6443`,
        machineType: node.controlPlane ? "controlplane" : "worker",
        machineSecrets: secrets.machineSecrets,
        talosVersion: args.talosVersion,
        kubernetesVersion: args.kubernetesVersion,
        configPatches: [
          ...args.patches.all,
          ...(node.controlPlane ? args.patches.controlPlane : []),
          args.patches.node(node),
        ],
      });

      return new talos.machine.ConfigurationApply(
        `${name}-${node.name}`,
        {
          clientConfiguration: secrets.clientConfiguration,
          machineConfigurationInput: configuration.machineConfiguration,
          node: node.ip,
          endpoint: node.ip,
        },
        parent,
      );
    });

    const bootstrap = new talos.machine.Bootstrap(
      `${name}-bootstrap`,
      {
        clientConfiguration: secrets.clientConfiguration,
        node: firstControlPlane,
        endpoint: firstControlPlane,
      },
      { ...parent, dependsOn: applies },
    );

    const kubeconfig = new talos.cluster.Kubeconfig(
      `${name}-kubeconfig`,
      {
        clientConfiguration: secrets.clientConfiguration,
        node: firstControlPlane,
        endpoint: firstControlPlane,
      },
      { ...parent, dependsOn: [bootstrap] },
    );

    this.kubeconfig = pulumi.secret(kubeconfig.kubeconfigRaw);
    this.talosconfig = pulumi.secret(
      talos.client.getConfigurationOutput({
        clusterName: args.clusterName,
        clientConfiguration: secrets.clientConfiguration,
        endpoints: controlPlaneIps,
        nodes: args.nodes.map((node) => node.ip),
      }).talosConfig,
    );
    this.ready = [bootstrap, kubeconfig];

    this.registerOutputs({
      kubeconfig: this.kubeconfig,
      talosconfig: this.talosconfig,
    });
  }
}
