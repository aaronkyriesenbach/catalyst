import { Project } from "@catalyst/core/constants";
import { site } from "@catalyst/site";
import { appHostname } from "@catalyst/platform/hostnames";
import {
  dnsTarget,
  httpTarget,
  serviceUrl,
  StatusGroup,
} from "@catalyst/platform/status";
import type { StaticApp } from "@catalyst/core/types";
import { awsRemoteKey, buildAwsExternalSecret } from "@catalyst/k8s/secrets";
import { mirrorRepository } from "@catalyst/versions/images";
import { readYaml } from "@catalyst/core/files";

// Unused until external-dns-ext switches to the Cloudflare provider once the zone is active.
const cloudflareTokenSecret = buildAwsExternalSecret("cloudflare-api-token", [
  {
    remoteKey: awsRemoteKey("external-dns", "cloudflare-api-token"),
    property: "api-token",
    secretKey: "api-token",
  },
]);

const name = "external-dns";
const healthPort = 7979;

const config: StaticApp = {
  kind: "static",
  name,
  project: Project.SYSTEM,
  status: {
    targets: [
      ...["external-dns-int", "external-dns-ext"].map((release) =>
        httpTarget(
          release === "external-dns-int"
            ? "External DNS (LAN)"
            : "External DNS (public)",
          StatusGroup.Platform,
          serviceUrl(release, name, healthPort, "/healthz"),
        ),
      ),
      dnsTarget(
        "Public DNS",
        "1.1.1.1",
        appHostname("status", { externallyAccessible: true }),
      ),
      dnsTarget("LAN DNS", "192.168.1.1", appHostname("zot")),
    ],
  },
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
        "extraArgs.zone-id-filter": site.cloudflareZoneId,
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
