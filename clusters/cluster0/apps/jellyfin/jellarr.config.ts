import { stringify } from "yaml";
import { appUrl } from "@catalyst/platform/hostnames";
import { jellyfinName, jellyfinUrl } from "./common";

const config = {
  version: 1,
  base_url: jellyfinUrl,
  system: {
    enableMetrics: false,
    pluginRepositories: [
      {
        name: "Jellyfin Stable",
        url: "https://repo.jellyfin.org/files/plugin/manifest.json",
        enabled: true,
      },
      {
        name: "K0lin-SSO",
        url: "https://raw.githubusercontent.com/k0lin/jellyfin-plugin-sso/manifest-release/manifest.json",
        enabled: true,
      },
    ],
    trickplayOptions: {
      enableHwAcceleration: false,
      enableHwEncoding: false,
    },
  },
  encoding: {
    enableHardwareEncoding: true,
    hardwareAccelerationType: "none",
    hardwareDecodingCodecs: ["h264", "vc1"],
    enableDecodingColorDepth10Hevc: true,
    enableDecodingColorDepth10Vp9: true,
    enableDecodingColorDepth10HevcRext: false,
    enableDecodingColorDepth12HevcRext: false,
    allowHevcEncoding: false,
    allowAv1Encoding: false,
  },
  library: {
    virtualFolders: [
      {
        name: "Movies",
        collectionType: "movies",
        libraryOptions: { pathInfos: [{ path: "/movies" }] },
      },
      {
        name: "Shows",
        collectionType: "tvshows",
        libraryOptions: { pathInfos: [{ path: "/tv" }] },
      },
      {
        name: "Live",
        collectionType: "homevideos",
        libraryOptions: { pathInfos: [{ path: "/live" }] },
      },
    ],
  },
  branding: {
    loginDisclaimer: `<form action="${appUrl(jellyfinName, { externallyAccessible: true })}/sso/OID/start/authentik">
  <button class="raised block emby-button button-submit">
    Sign in with SSO
  </button>
</form>`,
    customCss: `a.raised.emby-button {
  padding: 0.9em 1em;
  color: inherit !important;
}

.disclaimerContainer {
  display: block;
}`,
    splashscreenEnabled: false,
  },
  plugins: [{ name: "SSO-Auth" }],
};

export function buildJellarrYaml(): string {
  return stringify(config, { lineWidth: 0 });
}
