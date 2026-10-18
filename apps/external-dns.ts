import { cloudflareZoneId, Project } from "../constants";
import type { StaticApp } from "../types";
import {
  awsRemoteKey,
  buildAwsExternalSecret,
  mirrorRepository,
  readYaml,
} from "../utils";

// Unused until external-dns-ext switches to the Cloudflare provider once the zone is active.
const cloudflareTokenSecret = buildAwsExternalSecret("cloudflare-api-token", [
  {
    remoteKey: awsRemoteKey("external-dns", "cloudflare-api-token"),
    property: "api-token",
    secretKey: "api-token",
  },
]);

const config: StaticApp = {
  kind: "static",
  name: "external-dns",
  project: Project.SYSTEM,
  resources: [cloudflareTokenSecret],
  helmReleases: [
    {
      chart: "externalDns",
      releaseName: "external-dns-int",
      values: await readYaml(
        "./external-dns/internal-values.yaml",
        import.meta.url,
      ),
    },
    {
      chart: "externalDns",
      releaseName: "external-dns-ext",
      skipCrds: true,
      parameters: {
        "extraArgs.zone-id-filter": cloudflareZoneId,
        "image.repository": mirrorRepository(
          "registry.k8s.io/external-dns/external-dns",
        ),
      },
      values: await readYaml(
        "./external-dns/external-values.yaml",
        import.meta.url,
      ),
    },
  ],
};

export default config;
