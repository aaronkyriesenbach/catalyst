import { loadCatalog } from "@catalyst/core/apps";
import { validateCatalog } from "@catalyst/core/validate";

const catalog = await loadCatalog();
const problems = validateCatalog(catalog);

for (const problem of problems) {
  console.error(`error: ${problem}`);
}

console.log(
  `Checked ${catalog.entries.length} apps: ${problems.length} problem(s)`,
);
process.exit(problems.length > 0 ? 1 : 0);
