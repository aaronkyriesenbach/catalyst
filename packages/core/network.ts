// VLANs and host octets are object keys drawn from literal unions, so `tsc`
// rejects duplicates and out-of-range addresses; there is no custom validator.

type Enumerate<
  N extends number,
  Acc extends number[] = [],
> = Acc["length"] extends N
  ? Acc[number]
  : Enumerate<N, [...Acc, Acc["length"]]>;

export type Octet<From extends number, To extends number> =
  Exclude<Enumerate<To>, Enumerate<From>> | To;

// The literal second octet keeps every VLAN clear of cluster0's pod and service
// ranges (10.42/16, 10.43/16), Talos's defaults (10.96/12, 10.244/16) and the LAN.
export const labPrefix = "10.53" as const;
export type LabPrefix = typeof labPrefix;

export const gatewayOctet = 1 as const;

export const blockRanges = {
  network: [2, 9],
  vip: [10, 19],
  host: [20, 49],
  loadBalancer: [50, 99],
  dhcp: [100, 199],
} as const;

export type BlockName = keyof typeof blockRanges;
export type StaticBlockName = Exclude<BlockName, "dhcp">;

type BlockOctet<B extends BlockName> = Octet<
  (typeof blockRanges)[B][0],
  (typeof blockRanges)[B][1]
>;

export type VlanId = Octet<2, 254>;

export type Allocation = {
  readonly name: string;
  readonly description: string;
};

type BlockAllocations<B extends StaticBlockName> = {
  readonly [O in BlockOctet<B>]?: Allocation;
};

export type VlanDefinition = {
  readonly name: string;
  readonly description: string;
} & { readonly [B in StaticBlockName]?: BlockAllocations<B> };

export type NetworkPlan = { readonly [Id in VlanId]?: VlanDefinition };

export type Ipv4Host = `${number}.${number}.${number}.${number}/32`;

type OctetsOf<V, B extends StaticBlockName> = V extends {
  readonly [K in B]: infer A;
}
  ? keyof A & number
  : never;

export type VlanIp<
  Id extends number,
  O extends number,
> = `${LabPrefix}.${Id}.${O}`;

export type VlanCidr<Id extends number> = `${LabPrefix}.${Id}.0/24`;

export function cidrOf<Id extends VlanId>(vlan: Id): VlanCidr<Id> {
  return `${labPrefix}.${vlan}.0/24`;
}

export function gatewayOf<Id extends VlanId>(
  vlan: Id,
): VlanIp<Id, typeof gatewayOctet> {
  return `${labPrefix}.${vlan}.${gatewayOctet}`;
}

export function ipOf<
  P extends NetworkPlan,
  Id extends keyof P & VlanId,
  B extends StaticBlockName,
  O extends OctetsOf<P[Id], B>,
>(_plan: P, vlan: Id, _block: B, octet: O): VlanIp<Id, O> {
  return `${labPrefix}.${vlan}.${octet}`;
}

export function dhcpRangeOf(vlan: VlanId): { start: string; stop: string } {
  const [first, last] = blockRanges.dhcp;
  return {
    start: `${labPrefix}.${vlan}.${first}`,
    stop: `${labPrefix}.${vlan}.${last}`,
  };
}

export type PlannedAddress = {
  readonly octet: number;
  readonly ip: string;
  readonly name: string;
  readonly description: string;
};

export function allocationsOf(
  plan: NetworkPlan,
  vlan: VlanId,
  block: StaticBlockName,
): PlannedAddress[] {
  const entries: ReadonlyArray<readonly [string, Allocation | undefined]> =
    Object.entries(plan[vlan]?.[block] ?? {});
  return entries
    .flatMap(([octet, allocation]) =>
      allocation === undefined
        ? []
        : [
            {
              octet: Number(octet),
              ip: `${labPrefix}.${vlan}.${octet}`,
              ...allocation,
            },
          ],
    )
    .sort((a, b) => a.octet - b.octet);
}

export function isVlanId(value: number): value is VlanId {
  return Number.isInteger(value) && value >= 2 && value <= 254;
}

export type PlannedVlan = {
  readonly id: VlanId;
  readonly name: string;
  readonly description: string;
  readonly cidr: string;
  readonly gateway: string;
};

export function vlansOf(plan: NetworkPlan): PlannedVlan[] {
  const entries: ReadonlyArray<readonly [string, VlanDefinition | undefined]> =
    Object.entries(plan);
  return entries.flatMap(([key, definition]) => {
    const id = Number(key);
    if (definition === undefined || !isVlanId(id)) {
      return [];
    }
    return [
      {
        id,
        name: definition.name,
        description: definition.description,
        cidr: cidrOf(id),
        gateway: gatewayOf(id),
      },
    ];
  });
}
