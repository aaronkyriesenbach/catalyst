import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export function kubeconfigOf(stackName: string): pulumi.Output<string> {
  const stack = new pulumi.StackReference(stackName);

  return pulumi.secret(
    stack.requireOutput("kubeconfig").apply((value) => {
      if (typeof value !== "string") {
        throw new Error(`${stackName}: output kubeconfig is not a string`);
      }

      return value;
    }),
  );
}

export function kubernetesProvider(
  name: string,
  stackName: string,
): k8s.Provider {
  return new k8s.Provider(name, { kubeconfig: kubeconfigOf(stackName) });
}
