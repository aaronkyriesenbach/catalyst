package jellyfin

import (
	"lab53.net/shared-cue:shared"
	"encoding/yaml"
)

_app: shared.#application & {
	#name: "jellyfin"
	deployment: {
		spec: template: spec: {
			volumes: [shared.#nasVolumeSpec & {name: shared.#NAS_VOLUME_NAME}]
			containers: [{
				name:  "jellyfin"
				image: "jellyfin/jellyfin"
				ports: [{containerPort: 8096}]
				volumeMounts: [{
					name:      shared.#NAS_VOLUME_NAME
					mountPath: "/movies"
					subPath:   "movies"
				}, {
					name:      shared.#NAS_VOLUME_NAME
					mountPath: "/tv"
					subPath:   "tv"
				}]
			}]}}
	#webPort: 8096
	#useForwardAuth: false
}

yaml.MarshalStream([for o in _app {o}])
