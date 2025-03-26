package shared

#containers: [...{
	name:  string
	image: string
	ports: [...{
		containerPort: number
		name?:         string
	}]
}]