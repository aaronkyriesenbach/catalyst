import { applyModifiers, withIscsiVolumes, withNasMounts, withOidcAuth } from "../modifiers";
import type { WorkloadApp } from "../types";

const base: WorkloadApp = {
  kind: "workload",
  name: "navidrome",
  subDomain: "music",
  externallyAccessible: true,
  podSpec: {
    containers: [
      {
        name: "main",
        image: "ghcr.io/navidrome/navidrome:0.62.0",
        ports: [{ name: "http", containerPort: 4533 }],
        env: [
          { name: "ND_MUSICFOLDER", value: "/music" },
          { name: "ND_ADDRESS", value: "0.0.0.0" },
          { name: "ND_PORT", value: "4533" },
          { name: "ND_SCANONSCHEDULE", value: "0 0 */6 * *" },
          { name: "ND_ENFORCENONROOTUSER", value: "true" },
          { name: "ND_EXTAUTH_TRUSTEDSOURCES", value: "10.42.0.0/24,10.43.0.0/16" },
          { name: "ND_EXTAUTH_USERHEADER", value: "Remote-User" },
          { name: "ND_EXTAUTH_LOGOUTURL", value: "https://auth.lab53.net" },
          { name: "ND_SESSIONTIMEOUT", value: "168h" },
          { name: "ND_ENABLESHARING", value: "true" },
          { name: "ND_ENABLEDOWNLOADS", value: "true" },
        ],
        livenessProbe: {
          httpGet: { path: "/ping", port: 4533 },
          initialDelaySeconds: 10,
          periodSeconds: 30,
          failureThreshold: 3,
        },
        readinessProbe: {
          httpGet: { path: "/ping", port: 4533 },
          periodSeconds: 10,
          failureThreshold: 3,
        },
      },
    ],
  },
  webPort: 4533,
};

export default applyModifiers(
  base,
  withIscsiVolumes({
    main: [{ name: "data", mountPath: "/data", storageRequest: "10Gi" }],
  }),
  withNasMounts({
    main: [{ mountPath: "/music", subPath: "music" }],
  }),
  withOidcAuth({
    middleware: {
      enabled: true,
      headers: [
        { name: "Remote-User", value: "{{ .claims.preferred_username }}" },
        { name: "Remote-Email", value: "{{ .claims.email }}" },
      ],
    },
  }),
);
