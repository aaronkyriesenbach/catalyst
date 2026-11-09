import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { helmRelease } from "@catalyst/infra/helm";
import { lockedDownNamespace } from "@catalyst/infra/namespace";
import { hostnames } from "../common";
import { opts } from "./context";
import { gateway, gatewayName, gatewayNamespace } from "./gateway";
import {
  apiServerEgress,
  ciliumPolicy,
  dnsEgress,
  fromGateway,
} from "../policies";

export const adminEmail = "aaron@lab53.net";
export const adminUsername = "aaron";
export const omniClientId = "omni";

const namespace = lockedDownNamespace(
  "dex",
  { podSecurity: "restricted" },
  opts,
);

ciliumPolicy(
  "dex",
  namespace.name,
  {
    ingress: [fromGateway([5556])],
    egress: [dnsEgress, apiServerEgress],
  },
  { ...opts, parent: namespace.namespace },
);

const adminPassword = new random.RandomPassword("dex-admin-password", {
  length: 32,
  special: false,
});

export const omniClientSecret = new random.RandomPassword(
  "omni-oidc-client-secret",
  { length: 48, special: false },
);

const adminUserId = new random.RandomUuid("dex-admin-user-id");

const env = new k8s.core.v1.Secret(
  "dex-env",
  {
    metadata: { name: "dex-env", namespace: namespace.name },
    stringData: {
      OMNI_CLIENT_SECRET: omniClientSecret.result,
      ADMIN_PASSWORD_HASH: adminPassword.bcryptHash,
    },
  },
  opts,
);

const issuer = `https://${hostnames.dex}`;

const dex = helmRelease(
  "dex",
  {
    chart: "dex",
    namespace: namespace.name,
    values: {
      envFrom: [{ secretRef: { name: env.metadata.name } }],
      ingress: { enabled: false },
      https: { enabled: false },
      config: {
        issuer,
        storage: { type: "kubernetes", config: { inCluster: true } },
        web: { http: "0.0.0.0:5556" },
        oauth2: { skipApprovalScreen: false },
        enablePasswordDB: true,
        staticClients: [
          {
            id: omniClientId,
            name: "Omni",
            secretEnv: "OMNI_CLIENT_SECRET",
            redirectURIs: [`https://${hostnames.omni}/oidc/consume`],
          },
        ],
        staticPasswords: [
          {
            email: adminEmail,
            username: adminUsername,
            preferredUsername: adminUsername,
            userID: adminUserId.result,
            hashFromEnv: "ADMIN_PASSWORD_HASH",
          },
        ],
      },
    },
  },
  { ...opts, dependsOn: [namespace.namespace] },
);

new k8s.apiextensions.CustomResource(
  "dex-route",
  {
    apiVersion: "gateway.networking.k8s.io/v1",
    kind: "HTTPRoute",
    metadata: { name: "dex", namespace: namespace.name },
    spec: {
      parentRefs: [
        { name: gatewayName, namespace: gatewayNamespace, sectionName: "dex" },
      ],
      hostnames: [hostnames.dex],
      rules: [{ backendRefs: [{ name: "dex", port: 5556 }] }],
    },
  },
  { ...opts, dependsOn: [gateway, dex] },
);

export const dexAdminPassword = pulumi.secret(adminPassword.result);
