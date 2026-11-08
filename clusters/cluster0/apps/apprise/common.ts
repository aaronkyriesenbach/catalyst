const name = "apprise";
const port = 8000;

export const appriseName = name;
export const apprisePort = port;

// No HTTPRoute exists on purpose: Apprise has no auth, so it stays in-cluster.
export const appriseUrl = `http://${name}.${name}.svc:${port}`;

// Simple stateful mode reads /config/<key>.yml, one file per notifying app.
export const appriseNotifiers = [
  "external-cert-deployer",
  "gatus",
  "victoria-metrics",
];
