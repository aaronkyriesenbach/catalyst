import { Project } from "../constants";
import type { StaticApp } from "../types";
import { awsRemoteKey, buildAwsExternalSecret } from "../utils";
import { internalCaResources } from "./cert-manager/internal-ca";
import { issuers } from "./cert-manager/issuers";

export const certManagerNamespace = "cert-manager";

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
