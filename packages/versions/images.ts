import { site } from "@catalyst/site";
import {
  images,
  postgresImages,
  type ImageEntry,
  type ImageKey,
  type PostgresMajor,
} from "./versions";

export function mirrorRepository(name: ImageEntry["name"]): string {
  for (const [registry, prefix] of Object.entries(site.mirror.prefixes)) {
    if (name.startsWith(`${registry}/`)) {
      return `${site.mirror.host}/${prefix}/${name.slice(registry.length + 1)}`;
    }
  }

  throw new Error(`No mirror prefix for ${name}`);
}

function renderImage(entry: ImageEntry): string {
  const repository = entry.mirrored ? mirrorRepository(entry.name) : entry.name;

  return `${repository}:${entry.tag}`;
}

export function image(key: ImageKey): string {
  return renderImage(images[key]);
}

export function postgresImage(major: PostgresMajor): string {
  return renderImage(postgresImages[major]);
}
