package ladder

//import "lab53.net/shared-cue:shared"

_config: {
	#name: "ladder"
	#containers: [{
		name:  "ladder"
		image: "ghcr.io/everywall/ladder:latest"
		ports: [{containerPort: 8080}]
	}]
}

#deployment: [waaa=string]: {
	apiVersion: "apps/v1"
	kind:       "Deployment"
	metadata:   {
		name: waaa
	}
	spec: {
		replicas: number | *1
		selector: {
			matchLabels: {
				app: waaa
			}
		}
	}
}

#deployment: ladder: {
	containers: "test"
}

//(shared & _config).#deployment
//shared.#deployment ladder:
//(shared & _config).#service