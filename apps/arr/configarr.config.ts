import { Scalar, stringify, type ScalarTag } from "yaml";
import { flaresolverrName, flaresolverrPort } from "./flaresolverr";
import { mediaPaths } from "./common";
import { sabnzbdName, sabnzbdPort } from "./sabnzbd";
import { torrentHost, torrentPort } from "./torrent";

class EnvRef {
  constructor(readonly name: string) {}
}

const envTag: ScalarTag = {
  tag: "!env",
  identify: (value: unknown) => value instanceof EnvRef,
  resolve: (str: string) => str,
  createNode: (_schema, value) => {
    const node = new Scalar((value as EnvRef).name);
    node.tag = "!env";
    return node;
  },
  stringify: (item) => String(item.value),
};

const env = (name: string) => new EnvRef(name);

export const configarrEnvNames = {
  radarr: "RADARR_API_KEY",
  sonarr: "SONARR_API_KEY",
  lidarr: "LIDARR_API_KEY",
  prowlarr: "PROWLARR_API_KEY",
  sabnzbd: "SABNZBD_API_KEY",
  nzbgeek: "NZBGEEK_API_KEY",
} as const;

type CategoryField = "movie_category" | "tv_category" | "music_category";

function torrentClient(categoryField: CategoryField, category: string) {
  return {
    name: "qBittorrent",
    type: "qbittorrent",
    enable: true,
    priority: 1,
    remove_completed_downloads: true,
    remove_failed_downloads: true,
    fields: {
      host: torrentHost,
      port: torrentPort,
      use_ssl: false,
      [categoryField]: category,
    },
  };
}

function usenetClient(categoryField: CategoryField, category: string) {
  return {
    name: "SABnzbd",
    type: "sabnzbd",
    enable: true,
    priority: 1,
    remove_completed_downloads: true,
    remove_failed_downloads: true,
    fields: {
      host: sabnzbdName,
      port: sabnzbdPort,
      use_ssl: false,
      api_key: env(configarrEnvNames.sabnzbd),
      [categoryField]: category,
    },
  };
}

function downloadClients(categoryField: CategoryField, category: string) {
  return {
    data: [
      torrentClient(categoryField, category),
      usenetClient(categoryField, category),
    ],
    delete_unmanaged: { enabled: true },
    config: {
      enable_completed_download_handling: true,
      auto_redownload_failed: true,
    },
  };
}

// Add the indexers you use here; each needs a Prowlarr `definition` name, e.g. "1337x". Prowlarr
// syncs them to every app, and anything not listed here is deleted. Credentials do not belong in
// Git: read them with env() from a Secret on the CronJob.
const indexers: {
  name: string;
  definition: string;
  sync_profile?: string;
  priority?: number;
  fields?: Record<string, unknown>;
  tags?: string[];
}[] = [
  {
    // `definition` is the preset's display name: its `definitionName` is the generic "Newznab",
    // which would match the first Newznab preset instead.
    name: "NZBgeek",
    definition: "NZBgeek",
    sync_profile: "Standard",
    priority: 25,
    fields: {
      baseUrl: "https://api.nzbgeek.info",
      apiPath: "/api",
      apiKey: env(configarrEnvNames.nzbgeek),
    },
  },
];

const flaresolverrTag = "flaresolverr";

const prowlarrApplication = (
  type: "Radarr" | "Sonarr" | "Lidarr",
  port: number,
  apiKeyEnv: string,
  syncCategories: number[],
) => ({
  name: type,
  type,
  sync_level: "fullSync",
  fields: {
    prowlarrUrl: "http://prowlarr:9696",
    baseUrl: `http://${type.toLowerCase()}:${port}`,
    apiKey: env(apiKeyEnv),
    syncCategories,
  },
});

// Lidarr has no album-folder field; the first path segment of the track format is the album folder.
const lidarrTrackName = "{track:00} - {Track Title}";
const lidarrAlbumFolder = "{Album Title} ({Release Year})";

const lidarrNaming = {
  renameTracks: true,
  replaceIllegalCharacters: true,
  artistFolderFormat: "{Artist Name}",
  standardTrackFormat: `${lidarrAlbumFolder}/${lidarrTrackName}`,
  multiDiscTrackFormat: `${lidarrAlbumFolder}/{medium:00}-${lidarrTrackName}`,
};

// Lidarr only knows "FLAC" and "FLAC 24bit" as separate qualities, so leaving 24bit out of the profile keeps hi-res out.
const lidarrFlacProfile = "FLAC 16-bit";

// Backstop for hi-res releases that don't label themselves 24bit, so Lidarr rates them as plain FLAC.
const lidarrHiResTerms = [
  "24bit",
  "24-bit",
  "24 bit",
  "24-44",
  "24-48",
  "24-88",
  "24-96",
  "24-176",
  "24-192",
  "88.2khz",
  "96khz",
  "176.4khz",
  "192khz",
  "DSD",
  "SACD",
];

const config = {
  trashGuideUrl: "https://github.com/TRaSH-Guides/Guides",
  recyclarrConfigUrl: "https://github.com/recyclarr/config-templates",

  radarr: {
    movies: {
      base_url: "http://radarr:7878",
      api_key: env(configarrEnvNames.radarr),
      quality_definition: { type: "movie" },
      include: [
        { template: "radarr-quality-definition-movie" },
        { template: "radarr-quality-profile-hd-bluray-web" },
        { template: "radarr-custom-formats-hd-bluray-web" },
      ],
      media_naming: {
        folder: "default",
        movie: { rename: true, standard: "standard" },
      },
      root_folders: [mediaPaths.movies],
      download_clients: downloadClients("movie_category", "radarr"),
    },
  },

  sonarr: {
    series: {
      base_url: "http://sonarr:8989",
      api_key: env(configarrEnvNames.sonarr),
      quality_definition: { type: "series" },
      include: [
        { template: "sonarr-quality-definition-series" },
        { template: "sonarr-v4-quality-profile-web-1080p" },
        { template: "sonarr-v4-custom-formats-web-1080p" },
      ],
      media_naming: {
        series: "default",
        season: "default",
        episodes: {
          rename: true,
          standard: "default",
          daily: "default",
          anime: "default",
        },
      },
      root_folders: [mediaPaths.tv],
      download_clients: downloadClients("tv_category", "sonarr"),
    },
  },

  // TRaSH publishes no Lidarr profiles, so the quality profile is defined here.
  lidarr: {
    music: {
      base_url: "http://lidarr:8686",
      api_key: env(configarrEnvNames.lidarr),
      media_naming_api: lidarrNaming,
      quality_profiles: [
        {
          name: lidarrFlacProfile,
          upgrade: { allowed: false, until_quality: "FLAC" },
          qualities: [{ name: "FLAC" }],
        },
      ],
      release_profiles: [{ enabled: true, ignored: lidarrHiResTerms }],
      root_folders: [
        {
          path: mediaPaths.music,
          name: "Music",
          metadata_profile: "Standard",
          quality_profile: lidarrFlacProfile,
        },
      ],
      download_clients: downloadClients("music_category", "lidarr"),
    },
  },

  prowlarr: {
    main: {
      base_url: "http://prowlarr:9696",
      api_key: env(configarrEnvNames.prowlarr),
      tags: [flaresolverrTag],
      indexer_proxies: {
        data: [
          {
            name: "FlareSolverr",
            type: "FlareSolverr",
            fields: {
              host: `http://${flaresolverrName}:${flaresolverrPort}/`,
              requestTimeout: 60,
            },
            tags: [flaresolverrTag],
          },
        ],
        delete_unmanaged: { enabled: true },
      },
      ...(indexers.length > 0 && {
        indexers: { data: indexers, delete_unmanaged: { enabled: true } },
      }),
      applications: {
        data: [
          prowlarrApplication(
            "Radarr",
            7878,
            configarrEnvNames.radarr,
            [2000, 2010, 2020, 2030, 2040, 2045, 2050, 2060, 2070, 2080],
          ),
          prowlarrApplication(
            "Sonarr",
            8989,
            configarrEnvNames.sonarr,
            [5000, 5010, 5020, 5030, 5040, 5045, 5050],
          ),
          prowlarrApplication(
            "Lidarr",
            8686,
            configarrEnvNames.lidarr,
            [3000, 3010, 3020, 3030, 3040],
          ),
        ],
        delete_unmanaged: { enabled: true },
        sync_indexers: true,
      },
    },
  },
};

export function buildConfigarrYaml(): string {
  return stringify(config, { customTags: [envTag], lineWidth: 0 });
}
