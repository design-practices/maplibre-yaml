/**
 * @file GeoJSON shorthand in content-collection map entries (ml-svf)
 * @module @maplibre-yaml/astro/utils/collection-sugar
 *
 * @description
 * `<Map src>` and `loadMapConfig` read a map file through core's YAML parser,
 * which expands the GeoJSON shorthand (`location:`, `locations:`, `region:`,
 * `route:` on a `type: geojson` source) into `data:` before validating. A
 * content collection hands its schema the parsed entry instead, so
 * {@link getMapSchema} and {@link getScrollytellingSchema} rejected the same
 * file with "GeoJSON source requires at least one of: url, data, or
 * prefetchedData". This expands the shorthand the way the parser does, at the
 * same places (the `sources:` record and every inline `layers[].source`), with
 * core's own expander, so a collection entry accepts what `<Map src>` accepts.
 *
 * @internal
 */

import { detectSugarKey, expandGeoSugar, isSugarError } from "@maplibre-yaml/core";
import type { CoreSchemaLike } from "./zod-bridge";

/** A problem with the shorthand itself, at its path in the entry. */
interface SugarIssue {
  path: (string | number)[];
  message: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Expand the shorthand on one source, in place. */
function expandSource(
  source: unknown,
  path: (string | number)[]
): SugarIssue | null {
  const detected = detectSugarKey(source);
  if (detected === null) return null;
  if (isSugarError(detected)) return { path, message: detected.message };

  const src = source as Record<string, unknown>;
  if (src["type"] !== "geojson") {
    return {
      path,
      message:
        `The "${detected}" shorthand is only valid on a "type: geojson" source. ` +
        `Move the geometry to a geojson source, or write this source's data directly.`,
    };
  }
  const conflicts = ["data", "url", "prefetchedData"].filter((key) =>
    Object.prototype.hasOwnProperty.call(src, key)
  );
  if (conflicts.length > 0) {
    return {
      path,
      message:
        `A geojson source using the "${detected}" shorthand must not also carry ` +
        `${conflicts.map((c) => `"${c}"`).join(" or ")}. Use exactly one of the ` +
        `shorthand key, "data", "url", or "prefetchedData".`,
    };
  }

  const expanded = expandGeoSugar(src[detected], detected);
  if (isSugarError(expanded)) {
    const tail = expanded.path ? expanded.path.split(".") : [];
    return {
      path: [...path, ...tail.map((part) => (/^\d+$/.test(part) ? Number(part) : part))],
      message: expanded.message,
    };
  }
  src["data"] = expanded.value;
  delete src[detected];
  return null;
}

/**
 * A copy of a map or scrollytelling entry with its GeoJSON shorthand
 * expanded, or the first shorthand problem. The entry itself is not changed.
 */
export function expandEntrySugar(
  entry: unknown
): { value: unknown } | { issue: SugarIssue } {
  if (!isPlainObject(entry)) return { value: entry };
  const sources = entry["sources"];
  const layers = entry["layers"];
  const hasSugar =
    (isPlainObject(sources) && Object.values(sources).some((s) => detectSugarKey(s) !== null)) ||
    (Array.isArray(layers) &&
      layers.some((l) => isPlainObject(l) && detectSugarKey(l["source"]) !== null));
  if (!hasSugar) return { value: entry };

  const copy = structuredClone(entry) as Record<string, unknown>;
  const copiedSources = copy["sources"];
  if (isPlainObject(copiedSources)) {
    for (const name of Object.keys(copiedSources)) {
      const issue = expandSource(copiedSources[name], ["sources", name]);
      if (issue) return { issue };
    }
  }
  const copiedLayers = copy["layers"];
  if (Array.isArray(copiedLayers)) {
    for (let i = 0; i < copiedLayers.length; i++) {
      const layer = copiedLayers[i];
      if (!isPlainObject(layer)) continue;
      const issue = expandSource(layer["source"], ["layers", i, "source"]);
      if (issue) return { issue };
    }
  }
  return { value: copy };
}

/** A core schema that reads an entry's GeoJSON shorthand first. */
export function withEntrySugar<T>(core: CoreSchemaLike<T>): CoreSchemaLike<T> {
  return {
    safeParse(value: unknown) {
      const expanded = expandEntrySugar(value);
      if ("issue" in expanded) {
        return { success: false, error: { issues: [expanded.issue] } };
      }
      return core.safeParse(expanded.value);
    },
  };
}
