import {
  ClusterSecretStore,
  IGeneratorRef,
} from "@kubernetes-models/external-secrets/external-secrets.io/v1";
import type { IPushSecretStoreRef } from "@kubernetes-models/external-secrets/external-secrets.io/v1alpha1";
import { ClusterGenerator } from "@kubernetes-models/external-secrets/generators.external-secrets.io/v1alpha1";
import { Project } from "../constants";
import type { HelmChart, StaticApp } from "../types";

const chart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "external-secrets",
  },
  spec: {
    repo: "https://charts.external-secrets.io",
    chart: "external-secrets",
    targetNamespace: "external-secrets",
    version: "2.3.0",
    set: {
      installCRDs: "true",
    },
  },
};

const clusterGeneratorName = "generated-password";

const clusterGenerator: ClusterGenerator = new ClusterGenerator({
  metadata: {
    name: clusterGeneratorName,
  },
  spec: {
    kind: "Password",
    generator: {
      passwordSpec: {
        length: 16,
        allowRepeat: true,
        noUpper: false,
      },
    },
  },
});

export const clusterGeneratorRef: IGeneratorRef = {
  apiVersion: clusterGenerator.apiVersion,
  kind: clusterGenerator.kind,
  name: clusterGeneratorName,
};

const AWS_SM_STORE_NAME = "aws-secrets-manager";
const AWS_SM_CREDENTIALS_SECRET = "aws-sm-credentials";
const AWS_SM_NAMESPACE = "external-secrets";

const awsSecretStore = new ClusterSecretStore({
  metadata: { name: AWS_SM_STORE_NAME },
  spec: {
    provider: {
      aws: {
        service: "SecretsManager",
        region: "us-east-1",
        auth: {
          secretRef: {
            accessKeyIDSecretRef: {
              name: AWS_SM_CREDENTIALS_SECRET,
              namespace: AWS_SM_NAMESPACE,
              key: "access-key-id",
            },
            secretAccessKeySecretRef: {
              name: AWS_SM_CREDENTIALS_SECRET,
              namespace: AWS_SM_NAMESPACE,
              key: "secret-access-key",
            },
          },
        },
      },
    },
  },
});

export const awsSecretStoreRef: IPushSecretStoreRef = {
  name: AWS_SM_STORE_NAME,
  kind: "ClusterSecretStore",
};

const config: StaticApp = {
  kind: "static",
  name: "external-secrets",
  project: Project.SYSTEM,
  resources: [chart, clusterGenerator, awsSecretStore],
};

export default config;
