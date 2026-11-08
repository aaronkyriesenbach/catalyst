import { stringify } from "yaml";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recursively merges Helm values; `override` wins and arrays are replaced, not concatenated. */
export function mergeValues(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];

    merged[key] =
      isRecord(existing) && isRecord(value)
        ? mergeValues(existing, value)
        : value;
  }

  return merged;
}

// Kubernetes and ArgoCD parse YAML 1.1, where unquoted `on`/`off`/`yes`/`no` are booleans, but the
// `yaml` package defaults to 1.2 and leaves them bare; version "1.1" makes it quote them.
// Literal blocks keep embedded scripts readable; the default folds long lines into `>` blocks.
export function toYaml(value: unknown): string {
  return stringify(value, { blockQuote: "literal", version: "1.1" });
}
