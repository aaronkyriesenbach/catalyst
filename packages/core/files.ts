import { parse } from "yaml";
import { isRecord } from "./yaml";

export function readFile(relativePath: string, base: string): Promise<string> {
  return Bun.file(new URL(relativePath, base)).text();
}

export async function readYaml(
  relativePath: string,
  base: string,
): Promise<Record<string, unknown>> {
  const parsed: unknown = parse(await readFile(relativePath, base));

  if (!isRecord(parsed)) {
    throw new Error(`${relativePath} must contain a YAML mapping`);
  }

  return parsed;
}
