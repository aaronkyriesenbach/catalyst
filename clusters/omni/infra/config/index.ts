import * as command from "@pulumi/command";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as omni from "@pulumi/omni";
import { stringify } from "yaml";
import { kubeconfigOf, kubernetesProvider } from "@catalyst/infra/kubeconfig";
import { lockedDownNamespace } from "@catalyst/infra/namespace";
import { image } from "@catalyst/versions/images";
import { hostnames } from "../common";
import { ciliumPolicy, dnsEgress } from "../policies";

const config = new pulumi.Config();
const clusterStack = config.require("clusterStack");
const proxmoxStack = new pulumi.StackReference(config.require("proxmoxStack"));

const kubernetes = kubernetesProvider("omni", clusterStack);
const opts = { provider: kubernetes };

const initialKey = new command.local.Command("initial-service-account-key", {
  create: "sh ./read-initial-key.sh",
  dir: import.meta.dirname,
  environment: { KUBECONFIG_DATA: kubeconfigOf(clusterStack) },
  logging: "none",
});

const omniProvider = new omni.Provider("omni", {
  endpoint: `https://${hostnames.omni}`,
  serviceAccountKey: pulumi.secret(
    initialKey.stdout.apply((out) => out.trim()),
  ),
});

const proxmoxInfra = new omni.InfraProvider(
  "proxmox",
  { name: "proxmox", ttl: "2160h" },
  { provider: omniProvider },
);

const namespace = lockedDownNamespace(
  "omni-infra-provider",
  { podSecurity: "restricted" },
  opts,
);

const proxmoxUrl = proxmoxStack.requireOutput("proxmoxUrl");
const proxmoxPassword = proxmoxStack.requireOutput("omniInfraUserPassword");

const credentials = new k8s.core.v1.Secret(
  "omni-infra-provider-proxmox",
  {
    metadata: { name: "proxmox-provider", namespace: namespace.name },
    stringData: {
      OMNI_SERVICE_ACCOUNT_KEY: proxmoxInfra.key,
      "config.yaml": pulumi
        .all([proxmoxUrl, proxmoxPassword])
        .apply(([url, password]) =>
          stringify({
            proxmox: {
              url,
              username: "omni-infra",
              password,
              realm: "pve",
              insecureSkipVerify: true,
            },
          }),
        ),
    },
  },
  opts,
);

const labels = { "app.kubernetes.io/name": "omni-infra-provider-proxmox" };

new k8s.apps.v1.Deployment(
  "omni-infra-provider-proxmox",
  {
    metadata: { name: "proxmox-provider", namespace: namespace.name },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          automountServiceAccountToken: false,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 65532,
            seccompProfile: { type: "RuntimeDefault" },
          },
          containers: [
            {
              name: "provider",
              image: image("omniInfraProviderProxmox"),
              args: [
                "--config-file=/config/config.yaml",
                `--omni-api-endpoint=https://${hostnames.omni}`,
                "--omni-service-account-key=$(OMNI_SERVICE_ACCOUNT_KEY)",
              ],
              env: [
                {
                  name: "OMNI_SERVICE_ACCOUNT_KEY",
                  valueFrom: {
                    secretKeyRef: {
                      name: credentials.metadata.name,
                      key: "OMNI_SERVICE_ACCOUNT_KEY",
                    },
                  },
                },
              ],
              resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "500m", memory: "256Mi" },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              volumeMounts: [
                { name: "config", mountPath: "/config", readOnly: true },
              ],
            },
          ],
          volumes: [
            {
              name: "config",
              secret: {
                secretName: credentials.metadata.name,
                items: [{ key: "config.yaml", path: "config.yaml" }],
              },
            },
          ],
        },
      },
    },
  },
  opts,
);

ciliumPolicy(
  "omni-infra-provider",
  namespace.name,
  {
    egress: [
      dnsEgress,
      {
        toEntities: ["world", "ingress"],
        toPorts: [
          {
            ports: [
              { port: "443", protocol: "TCP" },
              { port: "8006", protocol: "TCP" },
            ],
          },
        ],
      },
    ],
  },
  { ...opts, parent: namespace.namespace },
);

export const infraProviderServiceAccount = proxmoxInfra.serviceAccountId;
