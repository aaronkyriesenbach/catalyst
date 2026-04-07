import { ConfigMap } from "kubernetes-models/v1";
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

const ddclientConfigMap = new ConfigMap({
  metadata: {
    name: "ddclient-config",
  },
  data: {
    "ddclient.conf": [
      "daemon=300",
      "syslog=yes",
      "ssl=yes",
      "use=web, web=https://checkip.amazonaws.com",
      "protocol=route53",
      "zone=lab53.net",
      "ttl=60",
      "login=aws_access_key_id_placeholder",
      "password=aws_secret_access_key_placeholder",
      "home.lab53.net",
    ].join("\n"),
  },
});

const ddclientDeployment = buildDeployment("ddclient", {
  containers: [
    {
      name: "ddclient",
      image: "lscr.io/linuxserver/ddclient:latest",
      env: [
        { name: "PUID", value: "1000" },
        { name: "PGID", value: "1000" },
      ],
      volumeMounts: [
        {
          name: "config",
          mountPath: "/config/ddclient.conf",
          subPath: "ddclient.conf",
        },
      ],
    },
  ],
  volumes: [
    {
      name: "config",
      configMap: {
        name: "ddclient-config",
      },
    },
  ],
});

const config: StaticApp = {
  kind: "static",
  name: "external-dns",
  resources: [
    internalChart,
    externalChart,
    ddclientConfigMap,
    ddclientDeployment,
  ],
};

export default config;
