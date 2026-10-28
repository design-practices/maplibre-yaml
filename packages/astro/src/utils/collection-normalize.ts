/**
 * @file Core's value normalizations for content-collection entries (0.10)
 * @module @maplibre-yaml/astro/utils/collection-normalize
 *
 * @description
 * Every document core reads -- a file, `<Map src>`, `loadMapConfig` -- goes
 * through core's value normalizations before validation: a root `$schema`
 * key is dropped, nested tables under a `locale` flatten to dotted keys, and
 * date objects become text. A content collection hands its schema the entry
 * Astro parsed instead, so {@link getMapSchema} and
 * {@link getScrollytellingSchema} run core's `normalizeDocumentValue` first,
 * or they would reject what `loadMapConfig` accepts: a TOML entry's
 * `[config.locale.NavigationControl]` table, a TOML date (smol-toml's
 * `TomlDate`) or a YAML date (a `Date`).
 *
 * @internal
 */

import { normalizeDocumentValue } from "@maplibre-yaml/core";
import type { CoreSchemaLike } from "./zod-bridge";

/** A core schema that normalizes an entry the way core does a document, first. */
export function withEntryNormalized<T>(core: CoreSchemaLike<T>): CoreSchemaLike<T> {
  return {
    safeParse(value: unknown) {
      const { value: normalized, issues } = normalizeDocumentValue(value);
      if (issues.length > 0) return { success: false, error: { issues } };
      return core.safeParse(normalized);
    },
  };
}
