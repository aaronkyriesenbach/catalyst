import {
  applyModifiers,
  buildPostgresResources,
  withOidcClient,
} from "../modifiers";
import type { WorkloadApp } from "../types";
import { dragonflyResources } from "./typetype/dragonfly";
import { downloaderResources } from "./typetype/downloader";
import { garageResources } from "./typetype/garage";
import { serverResources } from "./typetype/server";
import { secretsResources } from "./typetype/secrets";
import { tokenResources } from "./typetype/token";
import { image } from "../utils";
import { httpCheck, readiness } from "../probes";

const namespace = "typetype";

// Two Postgres instances: one per upstream database (typetype-server, typetype-downloader).
const serverPostgres = buildPostgresResources(
  "typetype-server",
  namespace,
  17,
  {
    database: "typetype",
    backup: true,
  },
);
const downloaderPostgres = buildPostgresResources(
  "typetype-downloader",
  namespace,
  17,
  { database: "typetype_downloader" },
);

const base: WorkloadApp = {
  kind: "workload",
  name: "typetype",
  podSpec: {
    containers: [
      {
        name: "main",
        image: image("typetype"),
        ports: [{ name: "http", containerPort: 80 }],
        livenessProbe: {
          httpGet: { path: "/api/version/web", port: 80 },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: readiness(httpCheck("/api/version/web", 80)),
      },
    ],
  },
  webPort: 80,
  externallyAccessible: true,
  // Work in progress: sync by hand until it is ready.
  autoSync: false,
  extraResources: [
    ...secretsResources,
    ...garageResources,
    ...dragonflyResources,
    ...serverPostgres,
    ...downloaderPostgres,
    ...serverResources,
    ...tokenResources,
    ...downloaderResources,
  ],
};

export default applyModifiers(
  base,
  withOidcClient({ redirectPaths: ["/auth/oidc/callback"] }),
);
