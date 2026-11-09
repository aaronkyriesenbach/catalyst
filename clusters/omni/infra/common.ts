import { allocationsOf, ipOf } from "@catalyst/core/network";
import { site } from "@catalyst/site";
import { infraVersions } from "@catalyst/versions/versions";

export const clusterName = "omni";

const { vlans } = site.network;
const vlan = site.omni.vlan;

export const apiVip = ipOf(vlans, vlan, "vip", 10);
export const gatewayIp = ipOf(vlans, vlan, "loadBalancer", 50);
export const wireguardIp = ipOf(vlans, vlan, "loadBalancer", 51);
export const wireguardPort = 50180;

export const nodes = allocationsOf(vlans, vlan, "host");
export const loadBalancers = allocationsOf(vlans, vlan, "loadBalancer");

export const podSubnet = "10.244.0.0/16";
export const serviceSubnet = "10.96.0.0/12";

export const talosVersion = infraVersions.talos.version;
export const kubernetesVersion = infraVersions.kubernetes.version.replace(
  /^v/,
  "",
);

const lab = `int.${site.domain}`;

export const hostnames = {
  omni: `omni.${lab}`,
  kubernetes: `omni-k8s.${lab}`,
  siderolink: `omni-siderolink.${lab}`,
  dex: `dex.${lab}`,
} as const;
