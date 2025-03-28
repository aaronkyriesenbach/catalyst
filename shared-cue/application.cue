package shared

#application: {
	_n=#name: string
	_hp=#hostPrefix: string | *_n
	#webPort: number
	_ufa=#useForwardAuth: bool | *true

	deployment: #deployment & {
		#name: _n
	}

	_containers: deployment.spec.template.spec.containers
	_ports: [for c in _containers for port in c.ports {port.containerPort}]

	service: #service & {
		#name: _n
		#expose: _ports
	}

	ingress: #ingressroute & {
		#name: _n
		#hostPrefix: _hp
		#port: #webPort
		#useForwardAuth: _ufa
	}
}