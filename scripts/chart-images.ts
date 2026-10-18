import { parseAllDocuments } from "yaml";
import {
  MIRROR_HOST,
  mirrorPrefixes,
  unmirroredChartImages,
} from "../constants";

// Also catches refs in args/env, which an `image:` field scan would miss.
const hostPattern = Object.keys(mirrorPrefixes)
  .map((host) => host.replaceAll(".", "\\."))
  .join("|");
const embeddedRef = new RegExp(
  `(?:^|[=\\s"'])((?:${hostPattern})/[\\w./-]+(?::[\\w.-]+)?)`,
  "g",
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectRefs(node: unknown, refs: Set<string>): void {
  if (typeof node === "string") {
    for (const match of node.matchAll(embeddedRef)) {
      const ref = match[1];

      if (ref !== undefined) {
        refs.add(ref);
      }
    }
  } else if (Array.isArray(node)) {
    for (const item of node) {
      collectRefs(item, refs);
    }
  } else if (isRecord(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key === "image" && typeof value === "string") {
        refs.add(value);
      } else {
        collectRefs(value, refs);
      }
    }
  }
}

function repositoryOf(ref: string): string {
  const withoutDigest = ref.split("@")[0] ?? ref;
  const tagColon = withoutDigest.indexOf(
    ":",
    withoutDigest.lastIndexOf("/") + 1,
  );
  const repository =
    tagColon === -1 ? withoutDigest : withoutDigest.slice(0, tagColon);
  const [first] = repository.split("/");
  const hasHost =
    repository.includes("/") &&
    first !== undefined &&
    (first.includes(".") || first.includes(":") || first === "localhost");

  if (hasHost) {
    return repository;
  }

  return repository.includes("/")
    ? `docker.io/${repository}`
    : `docker.io/library/${repository}`;
}

function isSkippedDocument(doc: unknown): boolean {
  if (!isRecord(doc)) {
    return true;
  }

  if (doc.kind === "CustomResourceDefinition") {
    return true;
  }

  const metadata = doc.metadata;
  const annotations = isRecord(metadata) ? metadata.annotations : undefined;
  const hook = isRecord(annotations) ? annotations["helm.sh/hook"] : undefined;

  // Argo never runs `helm test` hooks, so their images are never pulled.
  return typeof hook === "string" && hook.split(",").includes("test");
}

function findUnmirroredImages(release: string, manifests: string): string[] {
  const refs = new Set<string>();

  for (const document of parseAllDocuments(manifests)) {
    const doc: unknown = document.toJS();

    if (!isSkippedDocument(doc)) {
      collectRefs(doc, refs);
    }
  }

  const allowed = unmirroredChartImages.filter(
    (entry) => entry.release === release,
  );

  return [...refs]
    .filter((ref) => {
      const repository = repositoryOf(ref);

      return (
        !repository.startsWith(`${MIRROR_HOST}/`) &&
        !allowed.some((entry) => repository.startsWith(entry.repository))
      );
    })
    .sort();
}

export function assertChartImagesMirrored(
  release: string,
  manifests: string,
): void {
  const unmirrored = findUnmirroredImages(release, manifests);

  if (unmirrored.length > 0) {
    throw new Error(
      `Release '${release}' renders images that do not use ${MIRROR_HOST}:\n` +
        unmirrored.map((ref) => `  - ${ref}`).join("\n") +
        "\nMirror them with `parameters` or add them to unmirroredChartImages in constants.ts.",
    );
  }
}
