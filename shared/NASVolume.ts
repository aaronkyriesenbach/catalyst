import { KubePersistentVolume, KubePersistentVolumeClaim, Quantity } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";
import { NAS_IP, NAS_PATH } from "./constants.ts";

const STORAGE_CLASS_NAME = "nfs";

export default class NASVolume extends KubePersistentVolume {
  pvc: KubePersistentVolumeClaim;

  constructor(scope: Construct, props: NASVolumeProps) {
    const {
      volumeName = "nas-volume",
      size = "10Gi",
      accessModes = ["ReadWriteOnce"],
      pvcName,
      customNASPath,
    } = props;

    const sizeQuantity: Quantity = Quantity.fromString(size);

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: volumeName,
      },
      spec: {
        capacity: {
          storage: sizeQuantity,
        },
        accessModes: accessModes,
        persistentVolumeReclaimPolicy: "Retain",
        nfs: {
          server: NAS_IP,
          path: customNASPath ?? NAS_PATH,
        },
        storageClassName: STORAGE_CLASS_NAME,
      },
    });

    this.pvc = new KubePersistentVolumeClaim(this, "pvc", {
      metadata: {
        name: pvcName ?? `${volumeName}-pvc`,
      },
      spec: {
        resources: {
          requests: {
            storage: sizeQuantity,
          },
        },
        accessModes: accessModes,
        storageClassName: STORAGE_CLASS_NAME,
        volumeName: volumeName,
      },
    });
  }

  getPVCName() {
    return this.pvc.name;
  }
}

export type NASVolumeProps = {
  volumeName?: string;
  size?: string;
  accessModes?: string[];
  pvcName?: string;
  customNASPath?: string;
};
