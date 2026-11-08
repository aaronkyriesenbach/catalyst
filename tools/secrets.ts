import { loadAllAppConfigs } from "@catalyst/core/apps";
import { cluster } from "@catalyst/core/cluster";
import { listSecrets } from "@catalyst/k8s/secrets";

await loadAllAppConfigs();

const secrets = listSecrets();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(secrets, null, 2));
} else {
  console.log(`# AWS Secrets Manager keys used by cluster ${cluster.name}`);
  console.log("# generated: seeded and read back by the cluster");
  console.log(
    "# external: must exist already (created by hand or by another app)",
  );

  for (const { key, kind } of secrets) {
    console.log(`${kind.padEnd(10)} ${key}`);
  }
}
