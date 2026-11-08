import { Project } from "@catalyst/core/constants";
import { StatusGroup, tcpTarget } from "@catalyst/platform/status";
import type { StaticApp } from "@catalyst/core/types";
import { awsRemoteKey, buildAwsExternalSecret } from "@catalyst/k8s/secrets";
import { internalCaResources } from "./cert-manager/internal-ca";
import { certManagerNamespace } from "./cert-manager/common";
import { issuers } from "./cert-manager/issuers";

// Unused until the issuers switch to the Cloudflare solver once the zone is active.
const cloudflareTokenSecret = buildAwsExternalSecret("cloudflare-api-token", [
  {
    remoteKey: awsRemoteKey(certManagerNamespace, "cloudflare-api-token"),
    property: "api-token",
    secretKey: "api-token",
  },
]);

const config: StaticApp = {
  kind: "static",
  name: "cert-manager",
  status: {
    targets: [
      tcpTarget(
        "Cert Manager",
        StatusGroup.Platform,
        `cert-manager-webhook.${certManagerNamespace}.svc`,
        443,
      ),
    ],
  },
  project: Project.SYSTEM,
  resources: [...issuers, ...internalCaResources, cloudflareTokenSecret],
  helmReleases: [
    {
      chart: "certManager",
      releaseName: "cert-manager",
      parameters: { "crds.enabled": "true" },
    },
  ],
};

export default config;
