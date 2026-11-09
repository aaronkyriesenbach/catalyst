import * as k8s from "@pulumi/kubernetes";
import * as unifi from "@pulumiverse/unifi";
import { lockedDownNamespace } from "@catalyst/infra/namespace";
import { gatewayIp, hostnames } from "../common";
import { clusterIssuer, clusterIssuerName } from "./cert-manager";
import { opts } from "./context";
import { l2Announcement, loadBalancerPool } from "./load-balancer";

export const gatewayName = "omni";
export const gatewayNamespace = "gateway";

const namespace = lockedDownNamespace(
  gatewayNamespace,
  { podSecurity: "restricted" },
  opts,
);

const routeNamespaces = ["omni", "dex"];

const listeners = Object.entries(hostnames).map(([name, hostname]) => {
  const secretName = `${name}-tls`;

  new k8s.apiextensions.CustomResource(
    `${name}-certificate`,
    {
      apiVersion: "cert-manager.io/v1",
      kind: "Certificate",
      metadata: { name: secretName, namespace: namespace.name },
      spec: {
        secretName,
        dnsNames: [hostname],
        issuerRef: { name: clusterIssuerName, kind: "ClusterIssuer" },
      },
    },
    { ...opts, dependsOn: [clusterIssuer] },
  );

  return {
    name,
    hostname,
    port: 443,
    protocol: "HTTPS",
    tls: { mode: "Terminate", certificateRefs: [{ name: secretName }] },
    allowedRoutes: {
      namespaces: {
        from: "Selector",
        selector: {
          matchExpressions: [
            {
              key: "kubernetes.io/metadata.name",
              operator: "In",
              values: routeNamespaces,
            },
          ],
        },
      },
    },
  };
});

export const gateway = new k8s.apiextensions.CustomResource(
  "gateway",
  {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "Gateway",
    metadata: { name: gatewayName, namespace: namespace.name },
    spec: {
      gatewayClassName: "cilium",
      addresses: [{ type: "IPAddress", value: gatewayIp }],
      listeners,
    },
  },
  { ...opts, dependsOn: [loadBalancerPool, l2Announcement] },
);

for (const [name, hostname] of Object.entries(hostnames)) {
  new unifi.dns.Record(name, {
    name: hostname,
    type: "A",
    value: gatewayIp,
    enabled: true,
  });
}
