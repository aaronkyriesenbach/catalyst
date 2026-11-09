export const storageIds = {
  images: "talos-images",
  backups: "nas-backups",
  vmDisks: "local-lvm",
} as const;

export const poolId = "omni";
export const sdnZoneId = "lab";

// SDN ids allow letters and digits only, up to eight characters.
export function sdnVnetId(vlanName: string): string {
  return vlanName.replaceAll("-", "").slice(0, 8);
}

export const omniInfraPrivileges = [
  "Datastore.AllocateSpace",
  "Datastore.Audit",
  "Pool.Audit",
  "SDN.Use",
  "Sys.Audit",
  "VM.Allocate",
  "VM.Audit",
  "VM.Clone",
  "VM.Config.CDROM",
  "VM.Config.CPU",
  "VM.Config.Cloudinit",
  "VM.Config.Disk",
  "VM.Config.HWType",
  "VM.Config.Memory",
  "VM.Config.Network",
  "VM.Config.Options",
  "VM.Migrate",
  "VM.PowerMgmt",
] as const;
