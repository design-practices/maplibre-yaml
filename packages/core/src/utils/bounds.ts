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
 */

/** `[west, south, east, north]`. */
export type FlatBounds = [number, number, number, number];
/** `[[west, south], [east, north]]`. */
export type CornerBounds = [[number, number], [number, number]];

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Either form as `[west, south, east, north]`, or `null` when it is neither. */
export function toFlatBounds(value: unknown): FlatBounds | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 4 && value.every(isNumber)) return [...value] as FlatBounds;
  if (
    value.length === 2 &&
    value.every((corner) => Array.isArray(corner) && corner.length === 2 && corner.every(isNumber))
  ) {
    const [[w, s], [e, n]] = value as CornerBounds;
    return [w, s, e, n];
  }
  return null;
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

/**
 * What is wrong with a bounds value, in words — or `undefined` when it is a
 * valid bounds.
 *
 * @param key - The key as the author wrote it (`bounds`, `maxBounds`).
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

  // Four numbers.
  if (value.length === 4 && value.every(isNumber)) {
    const [a, b, c, d] = value as FlatBounds;
    const { ok, swappedOk } = ranges([a, c], [b, d]);
    if (ok) return undefined;
    if (swappedOk) {
      return (
        `${key} [${list([a, b, c, d])}] has a latitude outside -90 to 90: it looks written ` +
        `[latitude, longitude]. ${expected}. Did you mean [${list([b, a, d, c])}]?`
      );
    }
    return `${key} [${list([a, b, c, d])}] has a latitude outside -90 to 90. ${expected}.`;
  }

  // Two corners.
  if (
    value.length === 2 &&
    value.every((corner) => Array.isArray(corner) && corner.length === 2 && corner.every(isNumber))
  ) {
    const [[a, b], [c, d]] = value as CornerBounds;
    const { ok, swappedOk } = ranges([a, c], [b, d]);
    if (ok) return undefined;
    if (swappedOk) {
      return (
        `${key} [[${list([a, b])}], [${list([c, d])}]] has a latitude outside -90 to 90: each ` +
        `corner looks written [latitude, longitude]. ${expected}. Did you mean ` +
        `[[${list([b, a])}], [${list([d, c])}]]?`
      );
    }
    return `${key} [[${list([a, b])}], [${list([c, d])}]] has a latitude outside -90 to 90. ${expected}.`;
  }

  const numbers = value.filter(isNumber).length;
  if (numbers === value.length) {
    return `${key} has ${value.length} number${value.length === 1 ? "" : "s"}; it needs 4. ${expected}.`;
  }
  return `${expected}.`;
}
