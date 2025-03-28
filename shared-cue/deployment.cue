package shared

import (
	apps_v1 "k8s.io/api/apps/v1"
)

#deployment: apps_v1.#Deployment & {
	_n=#name: string

	apiVersion: "apps/v1"
	kind:       "Deployment"
	depMeta=metadata: #metadata & {#name: _n}
	spec: {
		replicas: number | *1
		selector: {
			matchLabels: {
				app: #name
			}
		}
		template: {
			metadata: depMeta
		}
	}
}
