package shared

import (
	core_v1 "k8s.io/api/core/v1"
)

#service: core_v1.#Service & {
	_n=#name: string
	#expose: [...number]

	apiVersion: "v1"
	kind:       "Service"
	metadata: #metadata & {#name: _n}
	spec: {
		selector: app: _n
		ports: [for p in #expose {port: p}]
	}
}
