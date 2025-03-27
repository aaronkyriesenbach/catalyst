package shared

import (
	meta_v1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

#metadata: meta_v1.#ObjectMeta & {
	#name: string

	name: #name
	labels: app: #name
}