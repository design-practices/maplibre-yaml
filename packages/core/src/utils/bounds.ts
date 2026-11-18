/**
 * @file The two ways to write map bounds, and what to say when neither fits
 * @module @maplibre-yaml/core/utils/bounds
 *
 * @description
 * MapLibre takes bounds as four numbers, `[west, south, east, north]`, or as
 * two corners, `[[west, south], [east, north]]` (its `LngLatBoundsLike`).
 * `config.bounds`, `config.maxBounds` (v1), `runtime.map.bounds` (v2) and a
 * chapter's `fitBounds` action accept both (ml-aot.76). When a value fits
 * neither, the message names the order — longitude first — and, when the
 * numbers only fit with latitude and longitude swapped, gives the swapped
 * value to copy (the slip `center:` gets the same help for, ml-aot.65).
 *
 * `maxBounds` alone may leave longitude open (ml-vwz): `-Infinity` west with
 * `Infinity` east together, the way `Map#setMaxBounds` takes it from
 * maplibre-gl 6.16 ("an unconstrained longitude range, with finite latitude
 * limits"). A half-open pair is refused in MapLibre's own words.
 */

/** `[west, south, east, north]`. */
export type FlatBounds = [number, number, number, number];
/** `[[west, south], [east, north]]`. */
export type CornerBounds = [[number, number], [number, number]];

/** How a bounds value is read. */
export interface BoundsOptions {
  /** Accept `-Infinity` west with `Infinity` east (`maxBounds`, maplibre-gl 6.16+). */
  openLongitude?: boolean;
}

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNumberOrInfinite = (v: unknown): v is number => typeof v === "number" && !Number.isNaN(v);

/** MapLibre's rule for `maxBounds` longitudes, in its words (`Transform.setMaxBounds`). */
export const OPEN_LONGITUDE_RULE =
  "Longitude maxBounds values must either be finite or span from -Infinity to Infinity";

/** Both longitudes finite, or `-Infinity` west with `Infinity` east. */
export const longitudesOk = (west: number, east: number): boolean =>
  (Number.isFinite(west) && Number.isFinite(east)) || (west === -Infinity && east === Infinity);

/** The raw pieces of either form, infinite values included; `null` when it is neither. */
function pieces(value: unknown): { flat: FlatBounds; corners: boolean } | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 4 && value.every(isNumberOrInfinite)) return { flat: [...value] as FlatBounds, corners: false };
  if (
    value.length === 2 &&
    value.every((corner) => Array.isArray(corner) && corner.length === 2 && corner.every(isNumberOrInfinite))
  ) {
    const [[w, s], [e, n]] = value as CornerBounds;
    return { flat: [w, s, e, n], corners: true };
  }
  return null;
}

/**
 * Either form as `[west, south, east, north]`, or `null` when it is neither.
 * Infinite values are refused unless `openLongitude` is set, and then only
 * `-Infinity` west with `Infinity` east together (finite latitudes always).
 */
export function toFlatBounds(value: unknown, options: BoundsOptions = {}): FlatBounds | null {
  const read = pieces(value);
  if (!read) return null;
  const [w, s, e, n] = read.flat;
  if (!isNumber(s) || !isNumber(n)) return null;
  if (isNumber(w) && isNumber(e)) return read.flat;
  return options.openLongitude && w === -Infinity && e === Infinity ? read.flat : null;
}

const ORDER =
  "[west, south, east, north] (four numbers, longitude first) or two corners " +
  "[[west, south], [east, north]]";

/**
 * Whether the latitudes hold, and whether the numbers would, swapped.
 * Longitudes are not range-checked: MapLibre takes bounds past ±180 to
 * cross the antimeridian (`[100, -50, 290, 62]` frames the Pacific).
 */
function ranges(lngs: number[], lats: number[]): { ok: boolean; swappedOk: boolean } {
  const latOk = (v: number) => Math.abs(v) <= 90;
  return {
    ok: lats.every(latOk),
    swappedOk: lngs.every(latOk) && lats.every((v) => Math.abs(v) <= 180),
  };
}

const list = (values: number[]) => values.join(", ");

/** A value as the author would write it, `-.inf` / `.inf` for the infinities. */
const yaml = (v: number) => (v === Infinity ? ".inf" : v === -Infinity ? "-.inf" : String(v));

/**
 * What is wrong with a bounds value, in words — or `undefined` when it is a
 * valid bounds.
 *
 * @param key - The key as the author wrote it (`bounds`, `maxBounds`). Only
 *   `maxBounds` may leave longitude open.
 */
export function boundsProblem(value: unknown, key = "bounds"): string | undefined {
  const expected = `${key} is written ${ORDER}`;

  if (typeof value === "string") {
    const parts = value.split(",").map((p) => p.trim());
    if (parts.length === 4 && parts.every((p) => /^[-+]?\d+(\.\d+)?$/.test(p))) {
      return `${key} needs square brackets: ${key}: [${parts.join(", ")}]. ${expected}.`;
    }
    return `${expected}; got the text "${value}".`;
  }
  if (!Array.isArray(value)) return `${expected}; got ${value === null ? "null" : typeof value}.`;

  const read = pieces(value);
  if (read) {
    const [a, b, c, d] = read.flat;
    const written = read.corners
      ? `[[${yaml(a)}, ${yaml(b)}], [${yaml(c)}, ${yaml(d)}]]`
      : `[${yaml(a)}, ${yaml(b)}, ${yaml(c)}, ${yaml(d)}]`;
    if (read.flat.some((v) => !Number.isFinite(v))) {
      const open = "-.inf west and .inf east";
      if (key !== "maxBounds") return `${key} ${written} needs finite numbers; only maxBounds leaves longitude open (${open}).`;
      if (!isNumber(b) || !isNumber(d)) return `${key} ${written}: the latitude limits must be finite; only longitude can be open (${open}).`;
      if (!longitudesOk(a, c)) return `${key} ${written}: ${OPEN_LONGITUDE_RULE}. Write ${open} together, or two finite longitudes.`;
      return ranges([], [b, d]).ok ? undefined : `${key} ${written} has a latitude outside -90 to 90. ${expected}.`;
    }
    const { ok, swappedOk } = ranges([a, c], [b, d]);
    if (ok) return undefined;
    if (swappedOk) {
      const meant = read.corners ? `[[${list([b, a])}], [${list([d, c])}]]` : `[${list([b, a, d, c])}]`;
      const how = read.corners ? "each corner looks written [latitude, longitude]" : "it looks written [latitude, longitude]";
      return `${key} ${written} has a latitude outside -90 to 90: ${how}. ${expected}. Did you mean ${meant}?`;
    }
    return `${key} ${written} has a latitude outside -90 to 90. ${expected}.`;
  }

  // An open longitude that did not arrive as one (ml-vwz): `null` is what
  // JSON.stringify makes of Infinity; a bare `Infinity` / `inf` is a string.
  const slots: unknown[] = value.length === 4 ? value : value.length === 2 && value.every(Array.isArray) ? (value as unknown[][]).flat() : [];
  const lngs = [slots[0], slots[2]];
  if (slots.length === 4 && lngs.some((v) => v === null)) {
    return `${key}: an open longitude does not survive JSON (Infinity becomes null); pass the document as YAML text, with -.inf west and .inf east.`;
  }
  if (slots.length === 4 && lngs.some((v) => typeof v === "string" && /^[-+]?(\.?inf(inity)?)$/i.test(v))) {
    return `${key}: an open longitude is written -.inf west and .inf east (YAML's infinity), not ${lngs.filter((v) => typeof v === "string").join(" / ")}.`;
  }

  const numbers = value.filter(isNumber).length;
  if (numbers === value.length) {
    return `${key} has ${value.length} number${value.length === 1 ? "" : "s"}; it needs 4. ${expected}.`;
  }
  return `${expected}.`;
}
