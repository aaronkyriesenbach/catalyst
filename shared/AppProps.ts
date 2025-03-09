import { Container, Volume } from "./imports/k8s.ts";

export type AppProps = {
    appName: string,
    containers?: Container[]
    initContainers?: Container[],
    volumes?: Volume[]
    createNASVolume?: boolean | string
    replicas?: number
    revisionHistoryLimit?: number
    podRestartPolicy?: "Always" | "OnFailure" | "Never"
}