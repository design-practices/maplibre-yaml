/**
 * @file GeoJSON-sugar pre-validation pass for the parser seam
 * @module @maplibre-yaml/core/parser/expand-sugar
 *
 * @description
 * The parser-side half of GeoJSON sugar (U2). {@link expandGeoSugar} (U1) turns
 * one authored sugar node into a `Feature`/`FeatureCollection`; this module
 * decides *where* those nodes live and rewrites them **in place on the raw
 * materialized value, before schema validation** (KTD1).
 *
 * Placement is the whole point:
 *
 * - It runs *after* version detection (so the walker knows v1 `sources`/inline
 *   `layers[].source` from v2 `style.sources`/`style.layers[].source`) and
 *   *before* `validateAgainst` — so the expanded `data:` is what `GeoJSONSchema`
 *   validates (a v2 RFC-7946 hard error) or what v1's lenient `z.any()` waves
 *   through (R3, dual posture inherited).
 * - It runs *after* `materialize` (the merge-fan-out DoS guard has already
 *   bounded the input); it constructs no new fan-out.
 *
 * Two things flow back out:
 *
 * 1. **In-place mutation.** For every `type: geojson` source carrying a sugar
 *    key, the key is replaced with `data: expandGeoSugar(...).value` and the
 *    sugar key deleted. The materialized value is disposable, so this is safe.
 * 2. **A path remap per expansion** ({@link SugarRemap}): `<sourcePath>.data →
 *    <sourcePath>.<sugarKey>`. Because the transform synthesizes a `data:` the
 *    author never wrote, a schema error on the expanded Feature carries a
 *    `…data.features.0.geometry.coordinates` path that has no node in the
 *    original YAML AST. The parser threads these remaps into `formatZodErrors`
 *    so such a path re-anchors to the sugar key's real position (KTD1a).
 *
 * Structural / gate / mutual-exclusion problems are returned as a
 * {@link ParseError} (never thrown) on the parser's existing error channel
 * (R5/R6). These are hard errors under both v1 and v2.
 */

import type { ParseError } from "./yaml-parser";
import {
  detectSugarKey,
  expandGeoSugar,
  isSugarError,
  type SugarKey,
} from "../model/sugar";

/**
 * A single expansion's error re-anchoring record.
 *
 * @property from - Path to the synthesized `data` node (e.g.
 *   `["style","sources","poly","data"]`).
 * @property to - Path to the authored sugar key the `data` replaced (e.g.
 *   `["style","sources","poly","region"]`). A schema error path beginning with
 *   `from` re-anchors to `to`, dropping the deeper Feature sub-path (which does
 *   not exist in the source), so the caret lands on the sugar key.
 */
export interface SugarRemap {
  readonly from: (string | number)[];
  readonly to: (string | number)[];
}

/** Success shape: the value was mutated in place; here are the remaps. */
export interface ExpandSugarResult {
  readonly remaps: SugarRemap[];
}

/** Plain (non-array) object narrowing. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own-property presence that never consults the prototype chain. */
function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Join a path array into the dot-separated string the parser reports. */
function pathString(parts: (string | number)[]): string {
  return parts.join(".");
}

/**
 * Attempt sugar expansion on one source object at `sourcePath`, mutating it in
 * place and recording a remap on success.
 *
 * @returns a {@link ParseError} to abort the parse, or `null` when there is
 *   nothing to do (no sugar key) or the expansion succeeded.
 */
function expandSourceAt(
  source: unknown,
  sourcePath: (string | number)[],
  remaps: SugarRemap[]
): ParseError | null {
  const detected = detectSugarKey(source);
  if (detected === null) return null;

  // >1 sugar key on one source — a mutual-exclusion violation among the sugars
  // themselves (R5). `detectSugarKey` owns this half.
  if (isSugarError(detected)) {
    return {
      path: pathString(sourcePath),
      code: "schema",
      message: detected.message,
    };
  }

  const key: SugarKey = detected;
  // `detectSugarKey` only returns a key for a plain object.
  const src = source as Record<string, unknown>;

  // R5/KTD2 — sugar is a `type: geojson` affordance. A sugar key on any other
  // source (or a type-less one) is a sugar-specific error, not a passthrough
  // that trips a generic source-union failure.
  if (src["type"] !== "geojson") {
    const found =
      typeof src["type"] === "string"
        ? `a "${src["type"]}" source`
        : "a source without a `type: geojson`";
    return {
      path: pathString(sourcePath),
      code: "schema",
      message:
        `The "${key}" sugar is only valid on a "type: geojson" source, but ` +
        `${pathString(sourcePath)} is ${found}. Move the geometry to a geojson ` +
        `source, or author this source's data directly.`,
    };
  }

  // R5 — mutual exclusion with the canonical data positions.
  const conflicts = ["data", "url"].filter((k) => hasOwn(src, k));
  if (conflicts.length > 0) {
    return {
      path: pathString(sourcePath),
      code: "schema",
      message:
        `A geojson source using the "${key}" sugar must not also carry ` +
        `${conflicts.map((c) => `"${c}"`).join(" or ")}. The sugar sits in the ` +
        `"data" position — use exactly one of the sugar key, "data", or "url".`,
    };
  }

  const expanded = expandGeoSugar(src[key], key);
  if (isSugarError(expanded)) {
    // The sugar error's `path` fragment already begins with the sugar key
    // (e.g. "region.coordinates"), so prefix it with the source's own path.
    const full = expanded.path
      ? `${pathString(sourcePath)}.${expanded.path}`
      : pathString(sourcePath);
    return { path: full, code: "schema", message: expanded.message };
  }

  // Replace the sugar key with the synthesized `data:` and record the remap so
  // a downstream schema error on the Feature re-anchors to the sugar key.
  src["data"] = expanded.value;
  delete src[key];
  remaps.push({
    from: [...sourcePath, "data"],
    to: [...sourcePath, key],
  });
  return null;
}

/**
 * Walk a v1-shaped map block's source positions: the `sources` record and every
 * inline `layers[].source`.
 */
function expandV1Block(
  block: Record<string, unknown>,
  basePath: (string | number)[],
  remaps: SugarRemap[]
): ParseError | null {
  const sources = block["sources"];
  if (isPlainObject(sources)) {
    for (const name of Object.keys(sources)) {
      const e = expandSourceAt(
        sources[name],
        [...basePath, "sources", name],
        remaps
      );
      if (e) return e;
    }
  }

  const layers = block["layers"];
  if (Array.isArray(layers)) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (isPlainObject(layer) && isPlainObject(layer["source"])) {
        const e = expandSourceAt(
          layer["source"],
          [...basePath, "layers", i, "source"],
          remaps
        );
        if (e) return e;
      }
    }
  }
  return null;
}

/**
 * Walk a v2-shaped map block's source positions: `style.sources` and every
 * inline `style.layers[].source`.
 */
function expandV2Block(
  block: Record<string, unknown>,
  basePath: (string | number)[],
  remaps: SugarRemap[]
): ParseError | null {
  const style = block["style"];
  if (!isPlainObject(style)) return null;

  const sources = style["sources"];
  if (isPlainObject(sources)) {
    for (const name of Object.keys(sources)) {
      const e = expandSourceAt(
        sources[name],
        [...basePath, "style", "sources", name],
        remaps
      );
      if (e) return e;
    }
  }

  const layers = style["layers"];
  if (Array.isArray(layers)) {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      if (isPlainObject(layer) && isPlainObject(layer["source"])) {
        const e = expandSourceAt(
          layer["source"],
          [...basePath, "style", "layers", i, "source"],
          remaps
        );
        if (e) return e;
      }
    }
  }
  return null;
}

/**
 * Expand sugar in a standalone map block, version-aware about where sources
 * live. Mutates `value` in place; returns the remaps or the first error.
 */
export function expandSugarInMapBlock(
  value: unknown,
  version: 1 | 2
): ExpandSugarResult | { error: ParseError } {
  const remaps: SugarRemap[] = [];
  if (!isPlainObject(value)) return { remaps };
  const error =
    version === 2
      ? expandV2Block(value, [], remaps)
      : expandV1Block(value, [], remaps);
  if (error) return { error };
  return { remaps };
}

/**
 * Walk a `pages[].blocks[]` array, expanding v1-shaped map blocks and recursing
 * into `mixed` containers. Root blocks are v1-shaped (RootSchema nests the v1
 * `MapBlockSchema`).
 */
function expandBlocks(
  blocks: unknown[],
  basePath: (string | number)[],
  remaps: SugarRemap[]
): ParseError | null {
  for (let k = 0; k < blocks.length; k++) {
    const block = blocks[k];
    if (!isPlainObject(block)) continue;
    const type = block["type"];
    if (type === "map" || type === "map-fullpage") {
      const e = expandV1Block(block, [...basePath, k], remaps);
      if (e) return e;
    } else if (type === "mixed" && Array.isArray(block["blocks"])) {
      const e = expandBlocks(
        block["blocks"] as unknown[],
        [...basePath, k, "blocks"],
        remaps
      );
      if (e) return e;
    }
  }
  return null;
}

/**
 * Expand sugar across the multi-page `RootSchema` surface (OQ1): root-level
 * `sources` and `layers` reuse records, plus every v1 map block under
 * `pages[].blocks[]` (including nested `mixed` blocks). Mutates `config` in
 * place; returns the remaps or the first error.
 */
export function expandSugarInRoot(
  config: unknown
): ExpandSugarResult | { error: ParseError } {
  const remaps: SugarRemap[] = [];
  if (!isPlainObject(config)) return { remaps };

  // Root-level reuse records (`$ref` targets).
  const sources = config["sources"];
  if (isPlainObject(sources)) {
    for (const name of Object.keys(sources)) {
      const e = expandSourceAt(sources[name], ["sources", name], remaps);
      if (e) return { error: e };
    }
  }
  const layers = config["layers"];
  if (isPlainObject(layers)) {
    for (const name of Object.keys(layers)) {
      const layer = layers[name];
      if (isPlainObject(layer) && isPlainObject(layer["source"])) {
        const e = expandSourceAt(
          layer["source"],
          ["layers", name, "source"],
          remaps
        );
        if (e) return { error: e };
      }
    }
  }

  const pages = config["pages"];
  if (Array.isArray(pages)) {
    for (let j = 0; j < pages.length; j++) {
      const page = pages[j];
      if (isPlainObject(page) && Array.isArray(page["blocks"])) {
        const e = expandBlocks(
          page["blocks"] as unknown[],
          ["pages", j, "blocks"],
          remaps
        );
        if (e) return { error: e };
      }
    }
  }

  return { remaps };
}
