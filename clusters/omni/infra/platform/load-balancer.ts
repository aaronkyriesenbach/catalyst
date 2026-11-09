import * as k8s from "@pulumi/kubernetes";
import { loadBalancers } from "../common";
import { opts } from "./context";

export const loadBalancerPool = new k8s.apiextensions.CustomResource(
  "omni-lb-pool",
  {
    apiVersion: "cilium.io/v2",
    kind: "CiliumLoadBalancerIPPool",
    metadata: { name: "omni" },
    spec: {
      blocks: loadBalancers.map((address) => ({
        start: address.ip,
        stop: address.ip,
      })),
    },
  },
  opts,
);

export const l2Announcement = new k8s.apiextensions.CustomResource(
  "omni-l2-announcement",
  {
    apiVersion: "cilium.io/v2alpha1",
    kind: "CiliumL2AnnouncementPolicy",
    metadata: { name: "omni" },
    spec: {
      loadBalancerIPs: true,
      interfaces: ["^(eth|en).*"],
    },
  },
  opts,
);
