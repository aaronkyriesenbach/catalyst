import * as proxmox from "@muhlba91/pulumi-proxmoxve";
import * as pulumi from "@pulumi/pulumi";

export type TalosVmArgs = {
  readonly name: string;
  readonly node: string;
  readonly vmId: number;
  readonly cores: number;
  readonly memoryMb: number;
  readonly diskGb: number;
  readonly datastore: string;
  readonly imageFileId: pulumi.Input<string>;
  readonly macAddress: string;
  readonly bridge: string;
  readonly pool: pulumi.Input<string>;
  readonly tags: readonly string[];
};

// Locally administered (02:), so it never collides with a vendor-assigned address.
export function macAddressFor(vlan: number, octet: number): string {
  const hex = (value: number) => value.toString(16).padStart(2, "0");

  return `02:53:${hex(vlan)}:00:00:${hex(octet)}`.toUpperCase();
}

export function talosVm(
  args: TalosVmArgs,
  opts?: pulumi.CustomResourceOptions,
): proxmox.VmLegacy {
  return new proxmox.VmLegacy(
    args.name,
    {
      name: args.name,
      nodeName: args.node,
      vmId: args.vmId,
      poolId: args.pool,
      tags: [...args.tags],
      machine: "q35",
      bios: "ovmf",
      onBoot: true,
      scsiHardware: "virtio-scsi-single",
      operatingSystem: { type: "l26" },
      agent: { enabled: true },
      cpu: { cores: args.cores, type: "host" },
      memory: { dedicated: args.memoryMb },
      efiDisk: {
        datastoreId: args.datastore,
        type: "4m",
        preEnrolledKeys: false,
      },
      disks: [
        {
          interface: "scsi0",
          datastoreId: args.datastore,
          importFrom: args.imageFileId,
          size: args.diskGb,
          discard: "on",
          iothread: true,
          ssd: true,
        },
      ],
      networkDevices: [
        {
          bridge: args.bridge,
          model: "virtio",
          macAddress: args.macAddress,
        },
      ],
    },
    opts,
  );
}
