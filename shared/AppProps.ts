import { Container, Volume } from "./imports/k8s";

export type AppProps = {
    appName: string
    containers: Container[]
    volumes?: Volume[]
    createNASVolume?: boolean | string
    replicas?: number
    revisionHistoryLimit?: number
}