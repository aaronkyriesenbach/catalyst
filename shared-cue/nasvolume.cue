package shared

import (
	core_v1 "k8s.io/api/core/v1"
)

#nasVolumeSpec: {
	name?: string
	nfs: {
		server: #NAS_IP
		path:   #NAS_PATH
	}
}

#nasVolume: core_v1.#PersistentVolume & {
	#capacity: string | *"10Gi"

	apiVersion: "v1"
	kind:       "PersistentVolume"
	metadata: name: #NAS_VOLUME_NAME
	spec: {
		capacity: storage: #capacity
		accessModes: ["ReadWriteMany"]
		persistentVolumeReclaimPolicy: "Retain"
		storageClassName:              "nfs"

		#nasVolumeSpec
	}
}
