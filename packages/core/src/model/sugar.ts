/**
 * @file GeoJSON authoring sugar → `Feature`/`FeatureCollection`
 * @module @maplibre-yaml/core/model/sugar
 *
 * @description
 * Format v2 keeps `location`, `locations`, `region`, and `route` as documented
 * GeoJSON *sugar* (V2-D2): a value that sits in the source `data` position on a
 * `type: geojson` source and "normalizes to `Feature`/`FeatureCollection`
 * immediately after parse." This module is that normalization — a pure,
 * front-end-agnostic transform from one authored sugar node to the GeoJSON it
 * stands for.
 *
 * It is a **leaf**: it imports no parser or schema module, so both the parser
 * seam (U2) and the Astro builders (U4) can depend on it without a cycle. The
 * GeoJSON `type`s it references come from `@types/geojson`, which is type-only.
 *
 * ## Two postures held here (KTD6/R6)
 *
 * 1. **Structural validation only.** The expander checks exactly the shapes it
 *    needs to *build* a Feature — `route` has ≥2 positions, `locations` is an
 *    array, `region.coordinates` is an array of rings, an innermost coordinate
 *    is an array. It does **not** enforce position element-count (2–3) or
 *    numeric element types: that strictness is `GeoJSONSchema`'s job downstream
 *    (a v2 hard error, a v1 lenient pass), and re-implementing it here would
 *    break the inherited dual posture. So a coordinate-*value* malformation
 *    (a 1-element position, a string where a number belongs) expands without
 *    complaint and is caught — or not — by the schema.
 *
 * 2. **Errors are returned, not thrown.** A malformation yields a structured
 *    {@link SugarError} carrying a `path` fragment; the parser seam (U2) turns
 *    it into a `ParseError` on the existing error channel. The expander itself
 *    never throws.
 *
 * ## Prototype-pollution safety (security)
 *
 * Sugar nodes are untrusted parsed input — the same class the
 * `normalize.ts` `partition()` guards with `Object.defineProperty`. This module
 * takes the stricter route available to it: it **only ever reads fixed literal
 * keys** (`coordinates`/`name`/`description`) and builds every geometry,
 * `properties`, and `Feature` object from fixed literal keys. The author node is
 * never spread and its keys are never generic-copied, so a `__proto__` /
 * `constructor` / `prototype` key cannot reach an assignment. Those keys are
 * additionally *rejected* by the unknown-key check (R4), so they surface as a
 * clear error rather than being silently dropped.
 */

import type {
  Feature,
  FeatureCollection,
  Point,
  Polygon,
  LineString,
  Position,
} from "geojson";

/**
 * The four V2-D2-named GeoJSON sugars. `Multi*` geometries are **not** sugar
 * (KTD3) — they are authored as canonical GeoJSON.
 */
export const SUGAR_KEYS = ["location", "locations", "region", "route"] as const;

/** One of {@link SUGAR_KEYS}. */
export type SugarKey = (typeof SUGAR_KEYS)[number];

/**
 * The only keys a sugar node (or a `locations` item) may carry: geometry plus
 * `name`/`description`. Styling and camera fields have no home in `source.data`
 * (R4/KTD2) — they are a layer-paint/camera concern.
 */
const ACCEPTED_NODE_KEYS = ["coordinates", "name", "description"] as const;

/**
 * A structured, path-anchored input error. Returned — never thrown — so the
 * parser seam (U2) can convert it to a `ParseError` on its existing channel.
 *
 * @property path - A fragment locating the offending value relative to the
 *   sugar key (e.g. `route.coordinates`, `locations.1.markerColor`). The parser
 *   prefixes it with the source's own path when re-anchoring.
 * @property message - Author-facing description of what is wrong.
 */
export interface SugarError {
  readonly path: string;
  readonly message: string;
}

/**
 * The success shape of {@link expandGeoSugar}: the built GeoJSON plus a
 * provenance seam (KTD5). `kind` and `source` are recorded so `ml-0fg.2` can
 * thread provenance without re-architecting the expander; every current caller
 * uses only `.value`.
 *
 * @property kind - Which sugar produced `value`.
 * @property value - The built `Feature` or `FeatureCollection`.
 * @property source - The original authored sugar node, unmodified.
 */
export interface ExpandResult {
  readonly kind: SugarKey;
  readonly value: Feature | FeatureCollection;
  readonly source: unknown;
}

/** True when `value` is a {@link SugarError} rather than a success result. */
export function isSugarError(value: unknown): value is SugarError {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { path?: unknown }).path === "string" &&
    typeof (value as { message?: unknown }).message === "string" &&
    !("kind" in (value as object))
  );
}

/** Plain (non-array) object narrowing, matching `normalize.ts`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Own-property presence that never consults the prototype chain. */
function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

/** Compose a path fragment, keeping it empty-safe. */
function joinPath(prefix: string, part: string | number): string {
  return prefix ? `${prefix}.${part}` : String(part);
}

function err(path: string, message: string): SugarError {
  return { path, message };
}

/**
 * Reject any own key on `node` outside {@link ACCEPTED_NODE_KEYS} (R4). Uses
 * `getOwnPropertyNames` so an own — even non-enumerable — `__proto__` /
 * `constructor` / `prototype` key is seen and rejected, not silently passed.
 */
function rejectUnknownKeys(
  node: Record<string, unknown>,
  kind: SugarKey,
  pathPrefix: string,
): SugarError | null {
  for (const key of Object.getOwnPropertyNames(node)) {
    if (!(ACCEPTED_NODE_KEYS as readonly string[]).includes(key)) {
      return err(
        joinPath(pathPrefix, key),
        `Unexpected key "${key}" on a "${kind}" sugar node. A sugar node accepts ` +
          `only ${ACCEPTED_NODE_KEYS.join(", ")}. Styling and camera fields ` +
          `(markerColor, zoom, color, width, fillColor, strokeColor, fillOpacity) ` +
          `belong on the layer's paint or camera, not in a source's data.`,
      );
    }
  }
  return null;
}

/**
 * Build the `{ name, description }` property bag from fixed literal keys,
 * defaulting each to `""` (matching `map-builders.ts`' `?? ""` convention).
 * The author node is read, never spread.
 */
function buildProperties(node: Record<string, unknown>): {
  name: unknown;
  description: unknown;
} {
  return {
    name: node["name"] ?? "",
    description: node["description"] ?? "",
  };
}

/**
 * Build one `Feature<Point>` from a location-shaped node, validating structure
 * and rejecting unknown keys. `pathPrefix` roots the error paths (the sugar key
 * for a bare `location`; `locations.<i>` for a `locations` item).
 */
function buildPointFeature(
  node: unknown,
  kind: SugarKey,
  pathPrefix: string,
): Feature<Point> | SugarError {
  if (!isPlainObject(node)) {
    return err(pathPrefix, `A "${kind}" sugar node must be an object with a "coordinates" key.`);
  }
  const unknownKey = rejectUnknownKeys(node, kind, pathPrefix);
  if (unknownKey) return unknownKey;

  const coordinates = node["coordinates"];
  if (!Array.isArray(coordinates)) {
    return err(
      joinPath(pathPrefix, "coordinates"),
      `A "${kind}" point's coordinates must be a [longitude, latitude] array.`,
    );
  }
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: coordinates as Position },
    properties: buildProperties(node),
  } as Feature<Point>;
}

/** `location` → `Feature<Point>`. */
function expandLocation(node: unknown): Feature<Point> | SugarError {
  return buildPointFeature(node, "location", "location");
}

/** `locations` → `FeatureCollection<Point>`, one Point per item. */
function expandLocations(node: unknown): FeatureCollection<Point> | SugarError {
  if (!Array.isArray(node)) {
    return err("locations", `"locations" sugar must be an array of location points.`);
  }
  const features: Feature<Point>[] = [];
  for (let i = 0; i < node.length; i++) {
    const feature = buildPointFeature(node[i], "locations", joinPath("locations", i));
    if (isSugarError(feature)) return feature;
    features.push(feature);
  }
  return { type: "FeatureCollection", features };
}

/** `region` → `Feature<Polygon>`; validates that coordinates is an array of rings. */
function expandRegion(node: unknown): Feature<Polygon> | SugarError {
  if (!isPlainObject(node)) {
    return err("region", `A "region" sugar node must be an object with a "coordinates" key.`);
  }
  const unknownKey = rejectUnknownKeys(node, "region", "region");
  if (unknownKey) return unknownKey;

  const coordinates = node["coordinates"];
  if (!Array.isArray(coordinates)) {
    return err(
      "region.coordinates",
      `A "region"'s coordinates must be an array of linear rings (Position[][]).`,
    );
  }
  for (let r = 0; r < coordinates.length; r++) {
    const ring = coordinates[r];
    if (!Array.isArray(ring)) {
      return err(
        joinPath("region.coordinates", r),
        `A "region" ring must be an array of positions (Position[]).`,
      );
    }
    for (let p = 0; p < ring.length; p++) {
      if (!Array.isArray(ring[p])) {
        return err(
          joinPath(joinPath("region.coordinates", r), p),
          `A "region" position must be a coordinate array.`,
        );
      }
    }
  }
  return {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: coordinates as Position[][] },
    properties: buildProperties(node),
  } as Feature<Polygon>;
}

/** `route` → `Feature<LineString>`; validates ≥2 positions. */
function expandRoute(node: unknown): Feature<LineString> | SugarError {
  if (!isPlainObject(node)) {
    return err("route", `A "route" sugar node must be an object with a "coordinates" key.`);
  }
  const unknownKey = rejectUnknownKeys(node, "route", "route");
  if (unknownKey) return unknownKey;

  const coordinates = node["coordinates"];
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return err(
      "route.coordinates",
      `A "route"'s coordinates must be an array of at least two positions.`,
    );
  }
  for (let p = 0; p < coordinates.length; p++) {
    if (!Array.isArray(coordinates[p])) {
      return err(
        joinPath("route.coordinates", p),
        `A "route" position must be a coordinate array.`,
      );
    }
  }
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: coordinates as Position[] },
    properties: buildProperties(node),
  } as Feature<LineString>;
}

/**
 * Detect the single sugar key present on a source object — the "exactly one"
 * half of R5.
 *
 * @returns the present {@link SugarKey}; `null` when none is present; a
 *   {@link SugarError} when more than one is present (mutual-exclusion
 *   violation). Presence is an own-property check, so an inherited key does not
 *   count as authored.
 */
export function detectSugarKey(source: unknown): SugarKey | null | SugarError {
  if (!isPlainObject(source)) return null;
  const present = SUGAR_KEYS.filter((key) => hasOwn(source, key));
  if (present.length === 0) return null;
  if (present.length > 1) {
    return err(
      "",
      `A geojson source may carry at most one sugar key, but found ${present
        .map((k) => `"${k}"`)
        .join(" and ")}. Use exactly one of ${SUGAR_KEYS.join(", ")}.`,
    );
  }
  return present[0] as SugarKey;
}

/**
 * Narrow a richer authored node down to `{ coordinates, name?, description? }`
 * by reading only those fixed literal keys — dropping any styling/camera fields
 * the expander would reject (R4). Used by Astro/U4, whose `LocationPoint` /
 * `RegionPolygon` / `RouteLine` carry `markerColor`/`zoom`/`fillColor`/… An
 * array (a `locations` value) is projected element-wise; a non-object is
 * returned unchanged for the caller's own structural error to surface.
 *
 * Only fixed literal keys are ever read or written, so this is prototype-safe.
 */
export function project(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(project);
  if (!isPlainObject(node)) return node;
  const projected: { coordinates: unknown; name?: unknown; description?: unknown } = {
    coordinates: node["coordinates"],
  };
  if (hasOwn(node, "name")) projected.name = node["name"];
  if (hasOwn(node, "description")) projected.description = node["description"];
  return projected;
}

/**
 * Expand one authored sugar node into the GeoJSON it stands for.
 *
 * @param node - the authored sugar *value* (the `location`/`locations`/`region`/
 *   `route` content, not the enclosing source). For Astro's richer nodes, pass
 *   `project(node)` first (R4).
 * @param key - which sugar `node` is, from {@link detectSugarKey}.
 * @returns an {@link ExpandResult} on success, or a {@link SugarError} for
 *   structural malformation or an unknown key. Never throws; never mutates
 *   `node`; expanding the same node twice is deep-equal.
 */
export function expandGeoSugar(node: unknown, key: SugarKey): ExpandResult | SugarError {
  let value: Feature | FeatureCollection | SugarError;
  switch (key) {
    case "location":
      value = expandLocation(node);
      break;
    case "locations":
      value = expandLocations(node);
      break;
    case "region":
      value = expandRegion(node);
      break;
    case "route":
      value = expandRoute(node);
      break;
    default:
      // Exhaustive over SugarKey; a non-key is an invalid call.
      return err("", `Unknown sugar key "${String(key)}".`);
  }
  if (isSugarError(value)) return value;
  return { kind: key, value, source: node };
}
