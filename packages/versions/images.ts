import { MIRROR_HOST, mirrorPrefixes } from "@catalyst/core/constants";
import {
  images,
  postgresImages,
  type ImageEntry,
  type ImageKey,
  type PostgresMajor,
} from "./versions";

export function mirrorRepository(name: ImageEntry["name"]): string {
  for (const [registry, prefix] of Object.entries(mirrorPrefixes)) {
    if (name.startsWith(`${registry}/`)) {
      return `${MIRROR_HOST}/${prefix}/${name.slice(registry.length + 1)}`;
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
