import { createAvatar } from "@dicebear/core";
import {
  create as loreleiCreate,
  meta as loreleiMeta,
  schema as loreleiSchema,
} from "@dicebear/lorelei-neutral";

/** The per-style package exposes the pieces @dicebear/core expects. */
const LORELEI = {
  create: loreleiCreate,
  meta: loreleiMeta,
  schema: loreleiSchema,
};

const cache = new Map<string, string>();

/**
 * Deterministic DiceBear "lorelei-neutral" avatar for a user seed
 * (email/username/subject). The neutral line-art style is friendly without
 * looking cartoonish, and the soft indigo backgrounds stay inside the HyperUI
 * palette. Cached because `toDataUri()` renders the SVG on every call otherwise.
 */
export function avatarDataUri(seed: string, size = 72): string {
  const key = `${seed}\u0000${size}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const uri = createAvatar(LORELEI, {
    seed,
    size,
    radius: 50,
    backgroundColor: ["e0e7ff", "c7d2fe", "dbeafe", "ede9fe", "e5e7eb"],
  }).toDataUri();
  cache.set(key, uri);
  return uri;
}
