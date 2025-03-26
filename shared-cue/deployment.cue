package shared

#deployment: [name]: {
	apiVersion: "apps/v1"
	kind:       "Deployment"
	metadata:   {
		name: name
	}
	spec: {
		replicas: number | *1
		selector: {
			matchLabels: {
				app: name
			}
		}
	}
}

//#deployment: {
//	apiVersion: "apps/v1"
//	kind:       "Deployment"
//	metadata:   #metadata
//	spec: {
//		replicas: number | *1
//		selector: {
//			matchLabels: #metadata.labels
//		}
//		template: #podspec
//	}
//}
