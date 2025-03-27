package ladder

import ("lab53.net/shared-cue:shared", "encoding/yaml")

_ladder: shared.#application & {
	#name: "ladder"
	deployment: spec: template: spec: containers: [{
		name:  "ladder"
		image: "ghcr.io/everywall/ladder:latest"
		ports: [{containerPort: 8080}]
		env: [{
			name:  "RULESET"
			value: "https://raw.githubusercontent.com/everywall/ladder-rules/main/ruleset.yaml"
		}]
	}]
	#webPort: 8080
	#hostPrefix: "ladder-cue"
}

yaml.MarshalStream([for o in _ladder {o}])