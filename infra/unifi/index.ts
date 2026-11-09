import * as unifi from "@pulumiverse/unifi";
import { dhcpRangeOf, vlansOf } from "@catalyst/core/network";
import { site } from "@catalyst/site";
import { policyRules, type ZoneRef } from "./policies";

const vlans = vlansOf(site.network.vlans);

const networks = vlans.map(
  (vlan) =>
    new unifi.Network(vlan.name, {
      name: vlan.name,
      purpose: "corporate",
      vlanId: vlan.id,
      subnet: `${vlan.gateway}/24`,
      dhcpEnabled: true,
      ...(({ start, stop }) => ({ dhcpStart: start, dhcpStop: stop }))(
        dhcpRangeOf(vlan.id),
      ),
    }),
);

const labZones = new Map(
  vlans.map((vlan, index) => {
    const network = networks[index];

    if (network === undefined) {
      throw new Error(`no network for VLAN ${vlan.name}`);
    }

    return [
      vlan.name,
      new unifi.firewall.Zone(vlan.name, {
        name: vlan.name,
        networks: [network.id],
      }),
    ] as const;
  }),
);

const builtInZoneId = (name: "Internal" | "External") =>
  unifi.firewall.getZoneOutput({ name }).id;

function zoneId(ref: ZoneRef) {
  if (ref === "internal") {
    return builtInZoneId("Internal");
  }

  if (ref === "external") {
    return builtInZoneId("External");
  }

  const zone = labZones.get(ref);

  if (zone === undefined) {
    throw new Error(`policy references VLAN zone ${ref}, which site.ts lacks`);
  }

  return zone.id;
}

for (const rule of policyRules) {
  new unifi.firewall.ZonePolicy(rule.name, {
    name: rule.name,
    action: "ALLOW",
    protocol: rule.protocol,
    autoAllowReturnTraffic: true,
    source: { zoneId: zoneId(rule.from), ips: rule.fromIps?.slice() },
    destination: {
      zoneId: zoneId(rule.to),
      ips: rule.toIps?.slice(),
      port: rule.port,
    },
  });
}

export const networkIds = Object.fromEntries(
  vlans.map((vlan, index) => [vlan.name, networks[index]?.id]),
);
