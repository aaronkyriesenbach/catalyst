import type { HelmChart, StaticApp } from "../types";
import { buildDeployment } from "../utils";

const internalChart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "external-dns-int",
  },
  spec: {
    repo: "https://kubernetes-sigs.github.io/external-dns/",
    chart: "external-dns",
    targetNamespace: "external-dns",
    version: "1.20.0",
    valuesContent: await Bun.file(
      new URL("./external-dns/internal-values.yaml", import.meta.url),
    ).text(),
  },
};

const externalChart: HelmChart = {
  apiVersion: "helm.cattle.io/v1",
  kind: "HelmChart",
  metadata: {
    name: "external-dns-ext",
  },
  spec: {
    repo: "https://kubernetes-sigs.github.io/external-dns/",
    chart: "external-dns",
    targetNamespace: "external-dns",
    version: "1.20.0",
    valuesContent: await Bun.file(
      new URL("./external-dns/external-values.yaml", import.meta.url),
    ).text(),
  },
};

const awsCredentialsSecretName = "aws-credentials";

const ddnsRoute53Deployment = buildDeployment("ddns-route53", {
  containers: [
    {
      name: "ddns-route53",
      image: "crazymax/ddns-route53:latest",
      env: [
        {
          name: "AWS_ACCESS_KEY_ID",
          valueFrom: {
            secretKeyRef: {
              name: awsCredentialsSecretName,
              key: "access-key-id",
            },
          },
        },
        {
          name: "AWS_SECRET_ACCESS_KEY",
          valueFrom: {
            secretKeyRef: {
              name: awsCredentialsSecretName,
              key: "secret-access-key",
            },
          },
        },
        {
          name: "DDNSR53_ROUTE53_HOSTEDZONEID",
          value: "Z01889102EIVWW3UBDYVL",
        },
        { name: "DDNSR53_ROUTE53_RECORDSSET_0_NAME", value: "home.lab53.net." },
        { name: "DDNSR53_ROUTE53_RECORDSSET_0_TYPE", value: "A" },
        { name: "DDNSR53_SCHEDULE", value: "*/5 * * * *" },
      ],
    },
  ],
});

const config: StaticApp = {
  kind: "static",
  name: "external-dns",
  resources: [internalChart, externalChart, ddnsRoute53Deployment],
};

export default config;
