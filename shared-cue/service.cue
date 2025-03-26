package shared

_containerPorts: [for c in #containers for port in c {port}]

#servicespec: {
	selector: #metadata.labels.app
//	ports: [...{
//		port: #webport
//	}]
}

#service: {
	apiVersion: "v1"
	kind: "Service"
	metadata: #metadata
	spec: #servicespec
}