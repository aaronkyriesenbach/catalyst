import { Container } from "./imports/k8s";

export type AppProps = {
    appName: string
    replicas?: number
    revisionHistoryLimit?: number
    containers: Container[]
}