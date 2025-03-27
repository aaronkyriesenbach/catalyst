package shared

#ingressroute: {
	_n=#name: string
	#hostPrefix: string | *_n
	#useForwardAuth: bool | *true
	#middlewares: [...{name: string, namespace?: string}] | *[]
	_middlewares: [if #useForwardAuth == true {
		name: "forwardauth-authelia"
		namespace: "authelia"
	}, for _m in #middlewares {_m}]
	#serviceName: string | *_n
	#useInsecureTransport: bool | *false
	#port: number

	apiVersion: "traefik.io/v1alpha1"
	kind: "IngressRoute"
	metadata: #metadata & { #name: _n }
	spec: {
		entryPoints: ["websecure"]
		routes: [{
			match: "Host(`\(#hostPrefix).lab53.net`)"
			kind: "Rule"
			middlewares: _middlewares
			services: [{
				name: #serviceName
				if #useInsecureTransport {
					serversTransport: "traefik-insecuretransport@kubernetescrd"
				}
				port: #port
			}]
		}]
		tls: {
			certResolver: "letsencrypt"
		}
	}
}